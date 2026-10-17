// docs-repo：把团队文档仓库克隆到项目根的 skills-init/，一步切到独立文档仓库模式
//   - 克隆（skills-init/ 里只有 tmp/ 时先挪开再放回；有产物、DocNexus 或项目模板时停下，不合并）
//   - 代码仓库 .gitignore 加 /skills-init/；文档仓库的 .git/info/exclude 加 /tmp/（本机临时文件不进文档仓库）
//   - 项目名写进 workflow/profile.json 的 artifacts.project（--project，或沿用已有的，默认 git 远端仓库名）
//   - 文档仓库里有 DocNexus 时接上本项目的链接与段落；还没装依赖时提示
// 不带地址运行：只显示当前状态

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, step, ok, warn, toPosix, findManifests, docnexusBin, docnexusRoot } from './core.mjs';
import { updateGitignore, excludeHomeTmp } from './install.mjs';
import { refreshDocNexusLinks } from './docnexus.mjs';
import { layout, setConfig, artifactsConfig, suggestProject } from '../../workflow/scripts/requirement.mjs';

const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });

function show(root) {
  const L = layout(root);
  if (L.mode !== 'repo') {
    console.log(`${HOME}/ 随项目提交（不是独立文档仓库）。要改用团队文档仓库：npx @rowansenne/skills-init docs-repo <仓库地址> [--project <项目名>]`);
    return 0;
  }
  const remote = git(L.repo, ['remote', 'get-url', 'origin']).stdout.trim() || '（没有 origin）';
  console.log(`${HOME}/ 是独立文档仓库：${remote}`);
  console.log(`  仓库名（引用前缀）：${L.repo_name}`);
  console.log(`  本项目的项目名：${L.project ?? '未配置（运行 docs-repo --project <项目名>）'}`);
  return 0;
}

export function docsRepo(root, { url, project }) {
  const home = path.join(root, HOME);
  if (!url && !project) return show(root);
  const installed = findManifests(root).length > 0;

  if (fs.existsSync(path.join(home, '.git'))) {
    const cur = git(home, ['remote', 'get-url', 'origin']).stdout.trim();
    if (url && cur && cur !== url) { warn(`${HOME}/ 已经是文档仓库（origin ${cur}），和给出的 ${url} 不同，没有改动。要换仓库请先自己挪走 ${HOME}/`); return 1; }
    ok(`${HOME}/ 已是文档仓库（origin ${cur || '无'}）`);
  } else {
    if (!url) { warn(`${HOME}/ 还不是文档仓库，需要给出仓库地址：docs-repo <仓库地址>`); return 1; }
    const entries = fs.existsSync(home) ? fs.readdirSync(home).filter((e) => e !== 'tmp' && e !== '.DS_Store') : [];
    if (entries.length) {
      warn(`${HOME}/ 里已有 ${entries.join('、')}（随项目提交的产物 / DocNexus / 项目模板），没有改动。
文档仓库的布局不同（需求下再分项目），不会自动合并：先把需要的内容放进文档仓库并提交，再挪走或删掉这些目录后重跑。`);
      return 1;
    }
    // tmp/ 是本机临时文件，克隆前挪开、克隆后放回
    const tmp = path.join(home, 'tmp');
    const park = fs.existsSync(tmp) ? path.join(root, `.${HOME}-tmp-${process.pid}`) : null;
    if (park) fs.renameSync(tmp, park);
    if (fs.existsSync(home)) fs.rmSync(home, { recursive: true, force: true });
    step(`克隆文档仓库到 ${HOME}/`);
    const r = spawnSync('git', ['clone', url, HOME], { cwd: root, stdio: 'inherit' });
    if (park) { fs.mkdirSync(home, { recursive: true }); fs.renameSync(park, path.join(home, 'tmp')); }
    if (r.status !== 0) { warn('git clone 失败（地址、权限或网络），没有改动'); return 1; }
    ok(`已克隆到 ${HOME}/`);
  }

  updateGitignore(root, false);
  excludeHomeTmp(root);
  const tracked = git(root, ['ls-files', '--', HOME]).stdout.trim();
  if (tracked) warn(`代码仓库里还跟踪着 ${HOME}/ 下的文件，运行 git rm -r --cached ${HOME} 后提交，代码仓库就不再管它`);

  if (!installed) {
    warn(`本项目还没安装 skills：先运行 npx @rowansenne/skills-init，项目名之后用 docs-repo --project <项目名> 配置（或第一次落盘时 skill 会问）`);
    return 0;
  }
  const name = project || artifactsConfig(root).project || suggestProject(root);
  const c = setConfig(root, { project: name });
  ok(`本项目在文档仓库里的项目名：${c.artifacts.project}（写在 ${c.file}，随代码提交，团队共用）`);

  if (fs.existsSync(path.join(docnexusRoot(root), 'docnexus', 'project.json'))) {
    const envs = findManifests(root)[0]?.m.envs ?? [];
    if (docnexusBin(root)) refreshDocNexusLinks(root, envs);
    else warn(`文档仓库里有 DocNexus，本机还没装它的依赖：运行 npx @rowansenne/skills-init upgrade --with-docnexus`);
  }
  const L = layout(root);
  step('完成');
  console.log(`  产物写到 ${toPosix(path.join(HOME, 'docs', 'requirements'))}/<需求名>/${L.project}/，引用写「${L.repo_name}:docs/requirements/...」`);
  console.log(`  写完产物后 skill 会列出文档仓库里没提交的文件，你确认后才提交；推送另外问`);
  return 0;
}

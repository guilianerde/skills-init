// docs-repo：让 workflow-run/ 成为团队文档仓库，一步切到独立文档仓库模式。两种模式目录结构相同，所以文件不用挪：
//   - workflow-run/ 里没有内容（或只有 tmp/）：直接克隆
//   - 已有产物、DocNexus 等内容：原地 git init 并接上远端。远端是空仓库时本地内容就是文档仓库的第一批内容；
//     远端已有内容时检出远端，本地文件和远端同路径冲突就退回原状、列出冲突的文件（不合并）
//   - 先把旧结构的产物迁到 <需求>/<项目名>/
//   - 代码仓库 .gitignore 加 /workflow-run/；文档仓库的 .git/info/exclude 加 /tmp/（本机临时文件不进文档仓库）
//   - 项目名写进 workflow/profile.json 的 artifacts.project（--project，或沿用已有的，默认 git 远端仓库名）
//   - 文档仓库里有 DocNexus 时接上本项目的链接与段落；还没装依赖时提示
// 不带地址运行：只显示当前状态

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOME, step, ok, warn, toPosix, findManifests, docnexusBin, docnexusRoot } from './core.mjs';
import { updateGitignore, excludeHomeTmp, reportMigration } from './install.mjs';
import { refreshDocNexusLinks } from './docnexus.mjs';
import { layout, setConfig, artifactsConfig, suggestProject, migrateLayout } from '../../workflow/scripts/requirement.mjs';

const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });

function show(root) {
  const L = layout(root);
  if (L.mode !== 'repo') {
    console.log(`${HOME}/ 随项目提交（不是独立文档仓库）。要改用团队文档仓库：npx @rowansenne/workflow-run docs-repo <仓库地址> [--project <项目名>]`);
    return 0;
  }
  const remote = git(L.repo, ['remote', 'get-url', 'origin']).stdout.trim() || '（没有 origin）';
  console.log(`${HOME}/ 是独立文档仓库：${remote}`);
  console.log(`  仓库名（引用前缀）：${L.repo_name}`);
  console.log(`  本项目的项目名：${L.project ?? '未配置（运行 docs-repo --project <项目名>）'}`);
  return 0;
}

// workflow-run/ 里已有内容：原地变成文档仓库。返回是否成功；失败时 workflow-run/ 保持原样（只多了迁移到新结构的产物）
function inPlace(root, home, url, project, installed) {
  // 先定项目名，再把旧结构迁到 <需求>/<项目名>/，这样和文档仓库里其他服务的目录对得上
  if (project && installed) setConfig(root, { project });
  reportMigration(migrateLayout(root));
  const remote = git(root, ['ls-remote', '--symref', url]);
  if (remote.status !== 0) { warn(`连不上 ${url}（地址、权限或网络），没有改动`); return false; }
  const heads = remote.stdout.split('\n').filter((l) => /\trefs\/heads\//.test(l)).map((l) => l.split('\t')[1].replace('refs/heads/', ''));
  const def = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(remote.stdout)?.[1] ?? (heads.includes('main') ? 'main' : heads[0]);
  step(`把 ${HOME}/ 原地变成文档仓库（${url}）`);
  const undo = () => fs.rmSync(path.join(home, '.git'), { recursive: true, force: true });
  if (git(home, ['init', '-q']).status !== 0 || git(home, ['remote', 'add', 'origin', url]).status !== 0) { undo(); warn('git init 失败，没有改动'); return false; }
  if (!heads.length) {
    git(home, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    ok(`远端是空仓库：${HOME}/ 里现有的内容就是文档仓库的第一批内容（分支 main）`);
    return true;
  }
  if (git(home, ['fetch', '-q', 'origin']).status !== 0) { undo(); warn('git fetch 失败，没有改动'); return false; }
  const co = git(home, ['checkout', '-q', '-b', def, '--track', `origin/${def}`]);
  if (co.status !== 0) {
    undo();
    const files = co.stderr.split('\n').filter((l) => /^\t/.test(l)).map((l) => l.trim());
    warn(`文档仓库里已有和 ${HOME}/ 同路径的文件，没有改动${files.length ? `：${files.join('、')}` : `（${co.stderr.trim()}）`}。
产物在各自的 <需求>/<项目名>/ 下，一般不会冲突；冲突多半来自 DocNexus：文档仓库里已有其他服务的知识库时，先按 DocNexus 的写入流程把本项目沉淀的内容写进去，再挪走本地的 docnexus/ 后重跑。`);
    return false;
  }
  ok(`已接上文档仓库 ${def} 分支；${HOME}/ 里本项目的内容还没提交`);
  return true;
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
      if (!inPlace(root, home, url, project, installed)) return 1;
    } else {
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
  }

  updateGitignore(root);
  excludeHomeTmp(root);
  const tracked = git(root, ['ls-files', '--', HOME]).stdout.trim();
  if (tracked) warn(`代码仓库里还跟踪着 ${HOME}/ 下的文件，运行 git rm -r --cached ${HOME} 后提交，代码仓库就不再管它`);

  if (!installed) {
    warn(`本项目还没安装 skills：先运行 npx @rowansenne/workflow-run --with-docnexus --with-codegraph，项目名之后用 docs-repo --project <项目名> 配置（或第一次落盘时 skill 会问）`);
    return 0;
  }
  const name = project || artifactsConfig(root).project || suggestProject(root);
  const c = setConfig(root, { project: name });
  ok(`本项目在文档仓库里的项目名：${c.artifacts.project}（写在 ${c.file}，随代码提交，团队共用）`);

  if (fs.existsSync(path.join(docnexusRoot(root), 'docnexus', 'project.json'))) {
    const envs = findManifests(root)[0]?.m.envs ?? [];
    if (docnexusBin(root)) refreshDocNexusLinks(root, envs);
    else warn(`文档仓库里有 DocNexus，本机还没装它的依赖：运行 npx @rowansenne/workflow-run upgrade --with-docnexus`);
  }
  const L = layout(root);
  const todo = git(home, ['status', '--porcelain', '--untracked-files=normal']).stdout.split('\n').filter(Boolean).length;
  step('完成');
  if (todo) console.log(`  ${HOME}/ 里有 ${todo} 处改动还没提交到文档仓库：git -C ${HOME} status 查看，确认后 git -C ${HOME} add -A && git -C ${HOME} commit，再 push`);
  console.log(`  产物写到 ${toPosix(path.join(HOME, 'docs', 'requirements'))}/<需求名>/${L.project}/，引用写「${L.repo_name}:docs/requirements/...」`);
  console.log(`  写完产物后 skill 会列出文档仓库里没提交的文件，你确认后才提交；推送另外问`);
  return 0;
}

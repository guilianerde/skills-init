// ---------------------------------------------------------------- glob
// ** 跨目录、* 不跨 /、? 单个字符、{a,b} 展开（括号里同样支持这些写法）；不含 / 的模式匹配文件名（同 .gitignore）。不区分大小写。
// 没有闭合的 { 按普通字符处理（画像里写错也不会卡住）
function globSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    const end = c === '{' ? glob.indexOf('}', i) : -1;
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (end > i) { re += `(?:${glob.slice(i + 1, end).split(',').map(globSource).join('|')})`; i = end; }
    else re += c.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return re;
}
export const globToRegExp = (glob) => new RegExp(`^${globSource(glob)}$`, 'i');
export const matchGlob = (p, glob) => globToRegExp(glob).test(glob.includes('/') ? p : p.split('/').pop());

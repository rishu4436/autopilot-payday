import { realpathSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, dirname, basename } from "node:path";
export function privatePath(value: string): string {
  let path = resolve(value), suffix = "";
  while (!existsSync(path)) { suffix = suffix ? `${basename(path)}${sep}${suffix}` : basename(path); path = dirname(path); }
  path = resolve(realpathSync(path), suffix);
  const inside = relative(realpathSync(process.cwd()), path);
  if (!(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) throw new Error("Keep private signer files outside the repository");
  return path;
}

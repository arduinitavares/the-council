import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../domain/hash.js";
import { readStrictFile, sha256 } from "./wrapper-contract.js";

/** rust-v0.164.0 PluginStore uses plugins/cache/<marketplace>/<plugin>/<version>.
 * Inspect loader roots, discoverable manifests and declared/default hook JSON;
 * never recursively walk plugin assets, skills, source code or hook commands. */
export function inventoryCodexPlugins(roots: string[], track: (file: string, kind?: "file" | "metadata") => void, unavailable: string[], effects: string[]) {
  const manifests = ["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"];
  let remaining = 500;
  const directories = (root: string) => {
    track(root,"metadata");
    if(!existsSync(root))return [];
    try {
      if(lstatSync(root).isSymbolicLink())throw Error("symlink");
      const entries=readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
      if((remaining-=entries.length)<0)throw Error("loader inventory bound");
      if(entries.some(entry=>entry.isSymbolicLink()))throw Error("symlink");
      return entries.filter(entry=>entry.isDirectory()).map(entry=>entry.name);
    } catch {unavailable.push(`CODEX_PLUGIN_LOADER_INVENTORY_UNAVAILABLE:${root}`);return [];}
  };
  const source = (root: string, leaf: string): any => {
    const file=join(root,leaf);
    try {
      if(lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())throw Error("plugin root");
      // Check each parent before hashing a nested source; never follow a link.
      let current=root;
      for(const part of leaf.split(sep)) {
        current=join(current,part);
        try {
          const stat=lstatSync(current);
          if(stat.isSymbolicLink())throw Error("symlink");
          if(current!==file){if(!stat.isDirectory())throw Error("non-directory");track(current,"metadata");}
          else if(!stat.isFile())throw Error("non-file");
        } catch(cause) {
          if((cause as NodeJS.ErrnoException).code!=="ENOENT")throw cause;
          track(current,"metadata");break;
        }
      }
      track(file);
      return existsSync(file)?readStrictFile(file,1024*1024):undefined;
    } catch {unavailable.push(`CODEX_PLUGIN_STARTUP_SOURCE_UNAVAILABLE:${file}`);return undefined;}
  };
  const builtinCandidates = (value: any, file: string) => {
    if(!value || typeof value!=="object")return;
    // Disabled ordinary handlers are not executable dependencies. MCP cleanup
    // handlers can survive the feature gate (plugin/bundled_hooks.rs); retain
    // them as explicit candidates for the authenticated platform-effect audit.
    if(value.type==="mcp_tool")effects.push(`codex-builtin-cleanup-candidate:${sha256(canonicalJson({file,handler:value}))}`);
    for(const child of Object.values(value))if(child&&typeof child==="object")builtinCandidates(child,file);
  };
  const plugin = (root: string) => {
    track(root,"metadata");
    for(const leaf of ["hooks.json","hooks/hooks.json"])builtinCandidates(source(root,leaf),join(root,leaf));
    for(const leaf of manifests) {
      const manifest=source(root,leaf);
      const hooks=manifest?.hooks;
      if(hooks==null)continue;
      if(typeof hooks==="string" || (Array.isArray(hooks)&&hooks.every(value=>typeof value==="string"))) {
        for(const hook of (typeof hooks==="string"?[hooks]:hooks) as string[]) {
          const target=resolve(root,hook);
          if(!hook.startsWith("./") || hook.split("/").includes("..") || !target.startsWith(root+sep) || /(?:auth|credential|token|secret)/i.test(hook) || !hook.endsWith(".json")) {
            unavailable.push(`CODEX_PLUGIN_HOOK_PATH_UNSUPPORTED:${join(root,leaf)}`);continue;
          }
          builtinCandidates(source(root,hook.slice(2)),target);
        }
      } else if(typeof hooks==="object" && (!Array.isArray(hooks) || hooks.every(value=>value!==null && typeof value==="object" && !Array.isArray(value))))builtinCandidates(hooks,join(root,leaf));
      else unavailable.push(`CODEX_PLUGIN_HOOK_DECLARATION_UNSUPPORTED:${join(root,leaf)}`);
    }
  };
  for(const root of roots) {
    for(const name of directories(root))if(!["cache","data","marketplaces"].includes(name))plugin(join(root,name));
    const cache=join(root,"cache");
    for(const marketplace of directories(cache))for(const name of directories(join(cache,marketplace))) {
      const base=join(cache,marketplace,name);
      for(const version of directories(base))plugin(join(base,version));
    }
  }
}

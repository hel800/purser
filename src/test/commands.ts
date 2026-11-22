// The backend's IPC surface, read from its source so the IPC mock can reject
// calls the real backend would: a renamed command or argument would
// otherwise pass every test and only fail in the app.

const lib = Object.values(
  import.meta.glob<string>("../../src-tauri/src/lib.rs", { query: "?raw", import: "default", eager: true })
)[0];

/** Arguments of one command, by the camelCase name Tauri expects from JS. */
export interface CommandArgs {
  required: string[];
  optional: string[];
}

// parameters Tauri injects itself instead of reading them from the call
const INJECTED = /^(tauri::)?(AppHandle|WebviewWindow|Window|Webview|State\b)/;

const camelCase = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Splits `a: A<B, C>, d: D` at the commas outside of generics. */
function splitParams(params: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseCommands(source: string): Map<string, CommandArgs> {
  const commands = new Map<string, CommandArgs>();
  const fn = /#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g;
  for (const [, name, params] of source.matchAll(fn)) {
    const args: CommandArgs = { required: [], optional: [] };
    for (const param of splitParams(params)) {
      const [, argName, type] = param.match(/^(\w+)\s*:\s*(.+)$/s)!;
      if (INJECTED.test(type)) continue;
      (type.startsWith("Option<") ? args.optional : args.required).push(camelCase(argName));
    }
    commands.set(name, args);
  }
  return commands;
}

/** Every `#[tauri::command]` function in lib.rs and its arguments. */
export const COMMAND_SIGNATURES = parseCommands(lib);

/** The commands lib.rs registers in `generate_handler!`. */
export const REGISTERED_COMMANDS = new Set(
  lib
    .match(/generate_handler!\[([^\]]*)\]/)![1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
);

// plugins built into Tauri itself; the rest must be registered in lib.rs
const CORE_PLUGINS = ["app", "event", "window", "webview", "path", "menu", "tray", "image", "resources"];

/** The plugins a `plugin:<name>|…` command may address. */
export const PLUGINS = new Set([
  ...CORE_PLUGINS,
  ...[...lib.matchAll(/tauri_plugin_(\w+)::/g)].map(([, name]) => name.replace(/_/g, "-")),
]);

/** Whether the backend has `cmd` at all, arguments aside. */
export function isKnownCommand(cmd: string): boolean {
  const plugin = cmd.match(/^plugin:([\w-]+)\|/);
  if (plugin) return PLUGINS.has(plugin[1]);
  return REGISTERED_COMMANDS.has(cmd) && COMMAND_SIGNATURES.has(cmd);
}

/**
 * What is wrong with `invoke(cmd, args)` for the real backend, or null.
 * It rejects unknown commands and missing arguments; an argument it doesn't
 * take is silently dropped, which is just as wrong (usually a typo). Plugin
 * commands are checked for the plugin only.
 */
export function contractViolation(cmd: string, args: Record<string, unknown>): string | null {
  if (!isKnownCommand(cmd)) return `"${cmd}" is not a backend command or a registered plugin's`;
  const signature = COMMAND_SIGNATURES.get(cmd);
  if (!signature) return null; // a plugin command
  const missing = signature.required.filter((name) => !(name in args));
  const known = [...signature.required, ...signature.optional];
  const unknown = Object.keys(args).filter((name) => !known.includes(name));
  if (missing.length) return `"${cmd}" is missing ${missing.join(", ")}`;
  if (unknown.length) return `"${cmd}" takes no ${unknown.join(", ")} (expects ${known.join(", ") || "nothing"})`;
  return null;
}

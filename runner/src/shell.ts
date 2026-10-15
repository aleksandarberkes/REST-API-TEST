import { spawn } from 'node:child_process';
import { ROOT } from './paths.js';

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command in the repo root; optionally streams every output line. */
export function sh(cmd: string, args: string[], onLine?: (line: string) => void): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: process.env });
    let stdout = '';
    let stderr = '';
    const pipe = (stream: NodeJS.ReadableStream, sink: (s: string) => void) => {
      let buf = '';
      stream.on('data', (chunk) => {
        const s = chunk.toString();
        sink(s);
        if (!onLine) return;
        buf += s;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        lines.forEach(onLine);
      });
      stream.on('end', () => buf && onLine?.(buf));
    };
    pipe(child.stdout, (s) => (stdout += s));
    pipe(child.stderr, (s) => (stderr += s));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function mustSh(cmd: string, args: string[], onLine?: (line: string) => void) {
  const r = await sh(cmd, args, onLine);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.code}): ${r.stderr || r.stdout}`);
  return r;
}

export const compose = (args: string[], onLine?: (line: string) => void) => sh('docker', ['compose', ...args], onLine);
export const mustCompose = (args: string[], onLine?: (line: string) => void) =>
  mustSh('docker', ['compose', ...args], onLine);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

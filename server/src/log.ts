import type { LogLevel } from './config';

export type Logger = Record<Exclude<LogLevel, 'silent'>, (msg: string, fields?: object) => void>;

const ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

/**
 * JSON-lines logger. Callers log ids and counts, never display names or message bodies,
 * so logs hold no personal data.
 */
export function createLogger(level: LogLevel): Logger {
  const min = ORDER.indexOf(level);
  const make =
    (lvl: Exclude<LogLevel, 'silent'>) =>
    (msg: string, fields?: object): void => {
      if (ORDER.indexOf(lvl) < min) return;
      const line = JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...fields });
      (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
    };
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
}

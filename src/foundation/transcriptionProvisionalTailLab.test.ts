import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('transcription provisional tail lab', () => {
  it('passes the offline reducer self-test', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), 'scripts/transcription-provisional-tail-lab.mjs'), '--self-test'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          CAUL_TRANSCRIPTION_LAB_DIR: path.join('artifacts', 'transcription-lab-self-test')
        }
      }
    );

    const summaryLine = result.stdout
      .split('\n')
      .find((line) => line.startsWith('caul-transcription-provisional-tail-lab '));

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(summaryLine).toBeTruthy();

    const summary = JSON.parse(summaryLine?.replace('caul-transcription-provisional-tail-lab ', '') ?? '{}');
    expect(summary).toMatchObject({
      mode: 'self-test',
      ok: true,
      eventTrace: {
        ok: true
      },
      provisional: {
        ok: true
      }
    });
    expect(summary.eventTrace.finalEvents).toBeGreaterThan(1);
    expect(summary.eventTrace.maxDurationMs).toBeLessThanOrEqual(30_000);
    expect(summary.provisional.failedCases).toEqual([]);
  });
});

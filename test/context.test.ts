import path from 'node:path';
import os from 'node:os';
import { execa } from 'execa';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runContext } from '../src/commands/context.js';
import { createProgram } from '../src/cli.js';
import { appendMemoryEntry } from '../src/core/jsonl-memory.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-flow-context-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpDir);
});

async function writeProject(): Promise<void> {
  await fs.ensureDir(path.join(tmpDir, '.planning'));
  await fs.writeFile(path.join(tmpDir, '.planning/STATE.md'), `# State

## Current Status

Billing webhook work is active.
`);
  await fs.writeFile(path.join(tmpDir, '.planning/PROJECT.md'), '# Project\n\n## Purpose\n\nTest project.\n');
  await fs.writeFile(path.join(tmpDir, '.planning/DECISIONS.md'), '- Billing webhook handlers must stay idempotent.\n');
  await fs.writeFile(path.join(tmpDir, '.planning/OPEN_QUESTIONS.md'), '- Should billing webhook retries alert support?\n');
  await fs.writeJson(path.join(tmpDir, 'package.json'), {
    scripts: {
      dev: 'next dev',
      test: 'vitest run',
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      build: 'tsc -p tsconfig.json',
    },
    dependencies: {
      next: '^15.0.0',
    },
  });
  await fs.writeFile(path.join(tmpDir, 'pnpm-lock.yaml'), '');
}

function output(): string {
  return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
}

describe('context command', () => {
  it('exists and help works', async () => {
    const contextCommand = createProgram().commands.find((command) => command.name() === 'context');

    expect(contextCommand).toBeDefined();
    expect(contextCommand?.helpInformation()).toContain('Usage: agent-flow context');
    expect(contextCommand?.helpInformation()).toContain('--budget-lines');
    expect(contextCommand?.helpInformation()).toContain('--json');
    expect(contextCommand?.helpInformation()).toContain('default-on');
  });

  it('includes project summary, git state, task, and relevant modules', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      module: 'billing',
      summary: 'Billing module owns Stripe webhooks and invoices.',
    });

    await runContext('fix duplicated Stripe webhook processing', { cwd: tmpDir });

    expect(output()).toContain('Task:\nfix duplicated Stripe webhook processing');
    expect(output()).toContain('Project Summary:');
    expect(output()).toContain('Package manager: pnpm');
    expect(output()).toContain('Stack: Next.js');
    expect(output()).toContain('test=pnpm test');
    expect(output()).toContain('Git Context:');
    expect(output()).toContain('Git: not detected');
    expect(output()).toContain('Relevant Modules:');
    expect(output()).toContain('[billing] Billing module owns Stripe webhooks and invoices.');
  });

  it('prioritizes decisions and errors over generic events when line budget is tight', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      status: 'accepted',
      summary: 'Stripe webhook processing must be idempotent.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'errors', {
      type: 'error',
      summary: 'Duplicated Stripe webhook processing created duplicate credits.',
      module: 'billing',
      cause: 'Missing processed event id guard.',
      solution: 'Store provider event ids before applying credits.',
    });
    for (let index = 0; index < 4; index += 1) {
      await appendMemoryEntry(tmpDir, 'events', {
        type: 'note',
        summary: `Billing webhook generic event ${index}.`,
        module: 'billing',
      });
    }

    await runContext('fix duplicated Stripe webhook processing', { cwd: tmpDir, budgetLines: 42 });

    const text = output();
    expect(text).toContain('Stripe webhook processing must be idempotent.');
    expect(text).toContain('Duplicated Stripe webhook processing created duplicate credits.');
    expect(text).not.toContain('Billing webhook generic event 3.');
  });

  it('respects --module filtering', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      module: 'billing',
      summary: 'Billing module owns Stripe webhooks.',
    });
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      module: 'auth',
      summary: 'Auth module owns login webhooks.',
    });

    await runContext('fix webhook processing', { cwd: tmpDir, module: 'billing' });

    expect(output()).toContain('Billing module owns Stripe webhooks.');
    expect(output()).not.toContain('Auth module owns login webhooks.');
  });

  it('respects --limit per section', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'modules', { type: 'module', module: 'billing', summary: 'Billing webhook module one.' });
    await appendMemoryEntry(tmpDir, 'modules', { type: 'module', module: 'billing', summary: 'Billing webhook module two.' });

    await runContext('billing webhook', { cwd: tmpDir, limit: 1 });

    const text = output();
    expect(text).toContain('Billing webhook module one.');
    expect(text).not.toContain('Billing webhook module two.');
  });

  it('respects --budget-lines while preserving project, verification, and usage sections', async () => {
    await writeProject();
    for (let index = 0; index < 8; index += 1) {
      await appendMemoryEntry(tmpDir, 'events', {
        type: 'note',
        module: 'billing',
        summary: `Billing webhook event ${index}.`,
      });
    }

    await runContext('billing webhook', { cwd: tmpDir, budgetLines: 36 });

    const text = output();
    expect(text.split('\n').length).toBeLessThanOrEqual(36);
    expect(text).toContain('Project Summary:');
    expect(text).toContain('Current State:');
    expect(text).toContain('Verification Commands:');
    expect(text).toContain('pnpm test');
    expect(text).toContain('Suggested Agent Usage:');
  });

  it('prints valid structured JSON with project and git fields', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'modules', {
      type: 'module',
      module: 'billing',
      summary: 'Billing module owns Stripe webhooks.',
    });

    await runContext('billing webhook', { cwd: tmpDir, json: true });

    const parsed = JSON.parse(output());
    expect(parsed).toMatchObject({
      task: 'billing webhook',
      project: {
        packageManager: 'pnpm',
        stack: ['Next.js'],
        commands: expect.objectContaining({
          test: 'pnpm test',
          lint: 'pnpm lint',
          typecheck: 'pnpm typecheck',
          build: 'pnpm build',
          dev: 'pnpm dev',
        }),
      },
      git: {
        available: false,
      },
      state: expect.any(String),
      items: {
        modules: expect.any(Array),
        decisions: expect.any(Array),
        errors: expect.any(Array),
        events: expect.any(Array),
        openQuestions: expect.any(Array),
      },
      verificationCommands: expect.any(Array),
      warnings: expect.any(Array),
    });
    expect(parsed.items.modules[0]).not.toHaveProperty('score');
  });

  it('includes lightweight git context when a git repository is available', async () => {
    await writeProject();
    await execa('git', ['init'], { cwd: tmpDir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    await execa('git', ['add', '.'], { cwd: tmpDir });
    await execa('git', ['commit', '-m', 'Initial context fixture'], { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, 'dirty.txt'), 'dirty');

    await runContext('billing webhook', { cwd: tmpDir, json: true });

    const parsed = JSON.parse(output());
    expect(parsed.git).toMatchObject({
      available: true,
      dirty: true,
      lastCommit: expect.stringContaining('Initial context fixture'),
    });
    expect(parsed.git.branch).toEqual(expect.any(String));
  });

  it('suppresses superseded decisions when active relevant decisions exist', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      status: 'accepted',
      summary: 'Billing webhook processing must be idempotent.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      status: 'superseded',
      summary: 'Billing webhook processing can rely on retry timing.',
      module: 'billing',
    });

    await runContext('billing webhook processing', { cwd: tmpDir });

    expect(output()).toContain('Billing webhook processing must be idempotent.');
    expect(output()).not.toContain('Billing webhook processing can rely on retry timing.');
  });

  it('includes an exact-match superseded decision when the task asks for it', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      status: 'accepted',
      summary: 'Billing webhook processing must be idempotent.',
      module: 'billing',
    });
    await appendMemoryEntry(tmpDir, 'decisions', {
      type: 'decision',
      status: 'superseded',
      summary: 'Billing webhook processing can rely on retry timing.',
      module: 'billing',
    });

    await runContext('Billing webhook processing can rely on retry timing', { cwd: tmpDir });

    expect(output()).toContain('Billing webhook processing can rely on retry timing.');
  });

  it('handles missing memory gracefully', async () => {
    await writeProject();

    await runContext('billing webhook', { cwd: tmpDir });

    expect(output()).toContain('not enough memory entries for a rich context pack');
  });

  it('does not include unrelated entries', async () => {
    await writeProject();
    await appendMemoryEntry(tmpDir, 'events', {
      type: 'note',
      module: 'auth',
      summary: 'Login session cookies rotate on refresh.',
    });

    await runContext('billing webhook', { cwd: tmpDir });

    expect(output()).not.toContain('Login session cookies rotate on refresh.');
  });
});

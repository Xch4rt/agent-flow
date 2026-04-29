import path from 'node:path';
import fs from 'fs-extra';
import { describe, expect, it } from 'vitest';

describe('README daily workflow', () => {
  it('documents the product-oriented Codex lifecycle', async () => {
    const readme = await fs.readFile(path.join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('## What It Is');
    expect(readme).toContain('## The Problem');
    expect(readme).toContain('## Quick Start');
    expect(readme).toContain('## Daily Workflow');
    expect(readme).toContain('## Available Skills');
    expect(readme).toContain('## How Memory Works');
    expect(readme).toContain('## Current Status / Roadmap');
    expect(readme).toContain('## Limitations');
    expect(readme).toContain('First-time setup:');
    expect(readme).toContain('Daily use:');
    expect(readme).toContain('agent-flow init --codex');
    expect(readme).toContain('agent-flow onboard');
    expect(readme).toContain('does not wipe custom content outside markers');
    expect(readme).toContain('$flow-onboard');
    expect(readme).toContain('$flow-resume');
    expect(readme).toContain('$flow-quick');
    expect(readme).toContain('$flow-plan');
    expect(readme).toContain('$flow-verify');
    expect(readme).toContain('$flow-close');
  });

  it('has balanced Markdown code fences', async () => {
    const readme = await fs.readFile(path.join(process.cwd(), 'README.md'), 'utf8');
    const fenceCount = readme.match(/```/g)?.length ?? 0;

    expect(fenceCount % 2).toBe(0);
  });
});

import path from 'node:path';
import fs from 'fs-extra';
import { describe, expect, it } from 'vitest';

describe('README', () => {
  it('is short, current, and routes depth to docs/', async () => {
    const readme = await fs.readFile(path.join(process.cwd(), 'README.md'), 'utf8');

    // Adoption-first structure.
    expect(readme).toContain('npm install -g @xch4rt/agent-flow');
    expect(readme).toContain('agent-flow init --claude');
    expect(readme).toContain('/flow-plan');
    expect(readme).toContain('/flow-harden');
    expect(readme).toContain('/flow-orchestrate');
    expect(readme).toContain('## The daily loop');
    expect(readme).toContain('demo/out/quickstart.gif');

    // Depth lives in docs/, linked from the README.
    expect(readme).toContain('docs/orchestration.md');
    expect(readme).toContain('docs/memory.md');
    expect(readme).toContain('docs/commands.md');

    // Deep-dive content must NOT be inlined anymore.
    expect(readme).not.toContain('## SQLite Memory Index');
    expect(readme).not.toContain('## How Memory Works');
    expect(readme).not.toContain('memory validation and migration');

    // Short enough to scan: hard budget on length.
    expect(readme.split('\n').length).toBeLessThan(160);
  });

  it('docs pages exist and carry the moved depth', async () => {
    const orchestration = await fs.readFile(path.join(process.cwd(), 'docs', 'orchestration.md'), 'utf8');
    expect(orchestration).toContain('orchestration.smoke');
    expect(orchestration).toContain('plan harden');
    expect(orchestration).toContain('waives');
    expect(orchestration).toContain('Tier 2');

    const memory = await fs.readFile(path.join(process.cwd(), 'docs', 'memory.md'), 'utf8');
    expect(memory).toContain('memory append');
    expect(memory).toContain('memory rebuild');
    expect(memory).toContain('Context pack');

    const commands = await fs.readFile(path.join(process.cwd(), 'docs', 'commands.md'), 'utf8');
    expect(commands).toContain('plan harden');
    expect(commands).toContain('review record');
    expect(commands).toContain('memory append');
  });

  it('has balanced Markdown code fences everywhere', async () => {
    for (const file of ['README.md', 'docs/orchestration.md', 'docs/memory.md', 'docs/commands.md']) {
      const text = await fs.readFile(path.join(process.cwd(), file), 'utf8');
      const fenceCount = text.match(/```/g)?.length ?? 0;
      expect(fenceCount % 2, file).toBe(0);
    }
  });
});

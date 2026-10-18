import { describe, expect, it } from 'vitest';
import {
  codexExecutorRole,
  codexHardenerRole,
  codexReviewerRole,
  flowCloseSkill,
  flowHardenSkill,
  flowOnboardSkill,
  flowOrchestrateSkill,
  flowPlanSkill,
  flowQuickSkill,
  flowResumeSkill,
  flowVerifySkill,
  openaiYaml,
  tomlMultiline,
} from '../src/adapters/codex/templates.js';
import { DEFAULT_CODEX_MODEL_ROUTING } from '../src/core/models.js';
import type { ProjectDetection } from '../src/core/detect-project.js';

const detection: ProjectDetection = {
  root: '/tmp/example',
  packageManager: 'pnpm',
  stacks: ['Next.js'],
  scripts: {},
  commands: {},
};

const TRIPLE = '"'.repeat(3);

describe('Codex skill templates', () => {
  it('flow-resume warns when the project has not been onboarded', () => {
    const skill = flowResumeSkill(detection);

    expect(skill).toContain('after `agent-flow onboard` has been run');
    expect(skill).toContain('`$flow-onboard` is optional enrichment');
    expect(skill).toContain('First detect shallow or fresh state');
    expect(skill).toContain('This project has not been onboarded yet. Run `agent-flow onboard` first.');
    expect(skill).toContain('offer a lightweight resume from existing files only');
    expect(skill).toContain('agent-flow context "current task or module"');
    expect(skill).toContain('agent-flow plan show --agent codex');
    expect(skill).toContain('uses the internal indexed memory when available');
    expect(skill).toContain('Avoid reading all memory when a context pack has enough relevant state.');
    expect(skill).toContain('agent-flow memory context');
    expect(skill).not.toContain('after `$flow-onboard` has been run');
  });

  it('flow-onboard mentions deterministic CLI onboarding', () => {
    const skill = flowOnboardSkill(detection);

    expect(skill).toContain('agent-flow onboard');
    expect(skill).toContain('deterministic onboarding');
    expect(skill).toContain('Recommended next commands');
    expect(skill).toContain('agent-flow doctor');
  });

  it('flow-close uses createdAt and prefers the memory append CLI', () => {
    const skill = flowCloseSkill();

    expect(skill).toContain('agent-flow context "<task>"');
    expect(skill).toContain('indexed `agent-flow context "<task>"` packs');
    expect(skill).toContain('agent-flow memory append');
    expect(skill).toContain('createdAt');
    expect(skill).toContain('Record decisions only when a real durable choice was made.');
    expect(skill).toContain('Record errors only when both cause and solution are known.');
    expect(skill).toContain('Do not duplicate every final response or append exact duplicates.');
    expect(skill).toContain('Recommended next commands');
    expect(skill).toContain('git status --short');
    expect(skill).not.toContain('"timestamp"');
  });

  it('all workflow skills end with recommended next commands and have Codex-valid frontmatter', () => {
    for (const skill of [
      flowOnboardSkill(detection),
      flowResumeSkill(detection),
      flowQuickSkill(detection),
      flowPlanSkill(),
      flowHardenSkill(),
      flowOrchestrateSkill(),
      flowVerifySkill(detection),
      flowCloseSkill(),
    ]) {
      expect(skill).toContain('Recommended next commands');
      // Codex requires `name` and a non-empty single-line `description` in the frontmatter.
      expect(skill).toMatch(/^---\nname: flow-[a-z]+\ndescription: \S[^\n]+\n---\n/);
      expect(skill).not.toContain('/flow-');
    }
  });

  it('flow-quick, flow-plan, and flow-verify mention task context and next steps', () => {
    expect(flowQuickSkill(detection)).toContain('agent-flow context "<task>"');
    expect(flowQuickSkill(detection)).toContain('agent-flow run -- <command>');
    expect(flowPlanSkill()).toContain('agent-flow context "<feature or task>"');
    expect(flowPlanSkill()).toContain('Recommended next commands');
    expect(flowPlanSkill()).toContain('$flow-verify');
    expect(flowPlanSkill()).toContain('$flow-close');
  });

  it('flow-plan authors plan.json and routes into harden + orchestrate', () => {
    const plan = flowPlanSkill();
    expect(plan).toContain('agent-flow plan init --scaffold');
    expect(plan).toContain('agent-flow plan validate');
    expect(plan).toContain('$flow-harden');
    expect(plan).toContain('$flow-orchestrate');
  });

  it('flow-orchestrate is a thin dispatcher over Codex custom agent roles', () => {
    const orchestrate = flowOrchestrateSkill();
    expect(orchestrate).toContain('agent-flow next --brief --agent codex');
    expect(orchestrate).toContain('agent-flow next --task <id> --json --agent codex');
    expect(orchestrate).toContain('agent-flow gate --task <id> --agent codex');
    expect(orchestrate).toContain('agent-flow advance --task <id>');
    expect(orchestrate).toContain('spawn_agent');
    expect(orchestrate).toContain('`fork_turns` = `none`');
    expect(orchestrate).toContain('flow_executor_light');
    expect(orchestrate).toContain('flow_executor_deep');
    expect(orchestrate).toContain('flow_reviewer');
    expect(orchestrate).toContain('review emit --phase <N> --reviewer');
    expect(orchestrate).toContain('review record --phase <N> --from-json');
    expect(orchestrate).toContain('Never revive a finished agent with `followup_task`');
    expect(orchestrate).toContain('do not hint at a verdict');
    expect(orchestrate).toContain('Never record a verdict the reviewer did not produce');
    expect(orchestrate).toContain('/new');
    expect(orchestrate).not.toContain('/clear');
    expect(orchestrate).not.toContain('SendMessage');
  });

  it('flow-harden delegates to the flow_hardener role through files', () => {
    const harden = flowHardenSkill();
    expect(harden).toContain('agent-flow plan harden > .agent-flow/harden.prompt.md');
    expect(harden).toContain('flow_hardener');
    expect(harden).toContain('plan harden --apply --from-json .agent-flow/harden.additions.json');
    expect(harden).toContain('waives');
  });

  it('openai.yaml carries display metadata', () => {
    const yaml = openaiYaml('Flow Plan', 'Plan "big" work', 'Use $flow-plan');
    expect(yaml).toContain('display_name: "Flow Plan"');
    expect(yaml).toContain('short_description: "Plan \\"big\\" work"');
    expect(yaml).toContain('default_prompt: "Use $flow-plan"');
  });
});

describe('Codex agent roles (.codex/agents/*.toml)', () => {
  it('executor roles carry the routed model and effort and the budget', () => {
    const light = codexExecutorRole(DEFAULT_CODEX_MODEL_ROUTING, 'light');
    expect(light).toContain('name = "flow_executor_light"');
    expect(light).toContain('model = "gpt-6-luna"');
    expect(light).toContain('model_reasoning_effort = "low"');
    expect(light).toContain(`developer_instructions = ${TRIPLE}`);
    expect(light).toContain('agent-flow next --task <id> --json --agent codex');
    expect(light).toContain('agent-flow gate --task <id> --no-record');
    expect(light).toContain('~150k tokens');
    expect(light).toContain('status: done | handoff | blocked');
    expect(light).toContain('Do not spawn subagents of your own.');

    const deep = codexExecutorRole({ ...DEFAULT_CODEX_MODEL_ROUTING, tiers: { ...DEFAULT_CODEX_MODEL_ROUTING.tiers, deep: { model: 'gpt-6-astra', effort: 'ultra' } } }, 'deep');
    expect(deep).toContain('name = "flow_executor_deep"');
    expect(deep).toContain('model = "gpt-6-astra"');
    expect(deep).toContain('model_reasoning_effort = "ultra"');
  });

  it('reviewer and hardener roles are independent and file-driven', () => {
    const reviewer = codexReviewerRole();
    expect(reviewer).toContain('name = "flow_reviewer"');
    expect(reviewer).toContain('model = "gpt-6.1-sol"');
    expect(reviewer).toContain('model_reasoning_effort = "high"');
    expect(reviewer).toContain('Default to "fail"');
    const hardener = codexHardenerRole();
    expect(hardener).toContain('name = "flow_hardener"');
    expect(hardener).toContain('additions: <n>');
  });

  it('role names are valid Codex agent names (lowercase, digits, underscores)', () => {
    for (const toml of [codexExecutorRole(), codexReviewerRole(), codexHardenerRole()]) {
      const name = /^name = "([^"]+)"$/m.exec(toml)?.[1];
      expect(name).toMatch(/^[a-z0-9_]+$/);
      // Only the opening and closing delimiters of developer_instructions may be a triple quote.
      expect(toml.split(TRIPLE)).toHaveLength(3);
    }
  });

  it('tomlMultiline escapes backslashes and triple quotes', () => {
    const out = tomlMultiline(`a\\b ${TRIPLE}x${TRIPLE}`);
    expect(out.startsWith(`${TRIPLE}\n`)).toBe(true);
    expect(out.endsWith(`\n${TRIPLE}`)).toBe(true);
    expect(out).toContain('a\\\\b');
    expect(out).toContain('""\\"x""\\"');
  });
});

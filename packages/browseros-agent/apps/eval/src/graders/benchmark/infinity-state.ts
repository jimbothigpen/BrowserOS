import { join, resolve } from 'node:path'
import type { GraderResult } from '../../types'
import type { Grader, GraderInput } from '../types'

interface InfinityEvalInput {
  app_server_url: string
  verifier_path: string
  task_id: string
}

interface InfinityEvalOutput {
  pass: boolean
  reward: number
  message: string
  state_snapshot?: Record<string, unknown> | null
}

const EVAL_SCRIPT = resolve(
  import.meta.dir,
  '../../../scripts/infinity-evaluate.py',
)

export class InfinityStateGrader implements Grader {
  name = 'infinity_state'

  async grade(input: GraderInput): Promise<GraderResult> {
    const parsed = this.parseQueryId(input.task.query_id)
    if (!parsed) {
      return {
        score: 0,
        pass: false,
        reasoning: `Cannot parse query_id "${input.task.query_id}" — expected format: infinity-{app}-{task_id}`,
      }
    }

    const appServerUrl = this.extractAppServerUrl(input)
    if (!appServerUrl) {
      return {
        score: 0,
        pass: false,
        reasoning:
          'Cannot determine app server URL. Set INFINITY_APP_URL or ensure start_url is in agent messages.',
      }
    }

    const infinityDir = process.env.WEBARENA_INFINITY_DIR
    if (!infinityDir) {
      return {
        score: 0,
        pass: false,
        reasoning:
          'WEBARENA_INFINITY_DIR env var not set. Point it to the webarena-infinity repo root.',
      }
    }

    const verifierPath = join(
      infinityDir,
      'apps',
      parsed.appName,
      'real-tasks',
      `${parsed.taskId}-verify.py`,
    )

    const evalInput: InfinityEvalInput = {
      app_server_url: appServerUrl,
      verifier_path: verifierPath,
      task_id: input.task.query_id,
    }

    try {
      const result = await this.runPythonEvaluator(evalInput)
      return {
        score: result.pass ? 1 : 0,
        pass: result.pass,
        reasoning: result.message,
        details: {
          reward: result.reward,
          state_snapshot: result.state_snapshot,
          app_name: parsed.appName,
        },
      }
    } catch (error) {
      return {
        score: 0,
        pass: false,
        reasoning: `Evaluator process error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  private parseQueryId(
    queryId: string,
  ): { appName: string; taskId: string } | null {
    const match = queryId.match(/^infinity-(.+?)-(.+)$/)
    if (!match) return null
    return { appName: match[1], taskId: match[2] }
  }

  private extractAppServerUrl(input: GraderInput): string | null {
    if (process.env.INFINITY_APP_URL) return process.env.INFINITY_APP_URL

    for (const msg of input.messages) {
      if (msg.type === 'user') {
        const match = msg.content.match(/http:\/\/localhost:\d+/)
        if (match) return match[0]
      }
    }

    return null
  }

  private async runPythonEvaluator(
    evalInput: InfinityEvalInput,
  ): Promise<InfinityEvalOutput> {
    const proc = Bun.spawn(['python3', EVAL_SCRIPT], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const inputJson = JSON.stringify(evalInput)
    proc.stdin.write(inputJson)
    proc.stdin.end()

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      throw new Error(
        `Python evaluator exited with code ${exitCode}: ${stderr || stdout}`,
      )
    }

    return JSON.parse(stdout.trim()) as InfinityEvalOutput
  }
}

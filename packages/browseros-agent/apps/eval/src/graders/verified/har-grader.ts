import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildHarFromMessages } from '../../capture/har-collector'
import type { GraderResult } from '../../types'
import type { Grader, GraderInput } from '../types'
import { buildAgentResponse } from './response-builder'

/**
 * WebArena-Verified HAR grader.
 *
 * Evaluation flow:
 * 1. Build a HAR file from the agent's tool-call messages
 * 2. Build agent_response.json from the final answer
 * 3. Write both to the task output directory
 * 4. Spawn verified-evaluate.py which calls the webarena-verified evaluator
 * 5. Parse the Python result into a GraderResult
 *
 * Requires: `pip install webarena-verified` in the Python environment
 */
export class VerifiedHarGrader implements Grader {
  name = 'verified_har'

  async grade(input: GraderInput): Promise<GraderResult> {
    const { messages, finalAnswer, outputDir, task } = input

    const taskType =
      (task as Record<string, unknown>).metadata != null
        ? (
            (task as Record<string, unknown>).metadata as Record<
              string,
              unknown
            >
          )?.additional != null
          ? ((
              (
                (task as Record<string, unknown>).metadata as Record<
                  string,
                  unknown
                >
              ).additional as Record<string, unknown>
            )?.task_type as string | undefined)
          : undefined
        : undefined

    const har = buildHarFromMessages(messages)
    const agentResponse = buildAgentResponse(finalAnswer, messages, taskType)

    const harPath = join(outputDir, 'network.har')
    const responsePath = join(outputDir, 'agent_response.json')

    await writeFile(harPath, JSON.stringify(har, null, 2))
    await writeFile(responsePath, JSON.stringify(agentResponse, null, 2))

    const originalTaskId =
      (task as Record<string, unknown>).metadata != null
        ? ((
            (task as Record<string, unknown>).metadata as Record<
              string,
              unknown
            >
          )?.original_task_id as string | undefined)
        : undefined

    const evalInput = JSON.stringify({
      task_id: originalTaskId || task.query_id,
      har_path: harPath,
      agent_response_path: responsePath,
    })

    try {
      const scriptPath = join(
        import.meta.dir,
        '..',
        '..',
        '..',
        'scripts',
        'verified-evaluate.py',
      )

      const proc = Bun.spawn(['python3', scriptPath], {
        stdin: new Blob([evalInput]),
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0) {
        return {
          score: 0,
          pass: false,
          reasoning: `Python evaluator exited with code ${exitCode}: ${stderr}`,
          details: {
            harPath,
            responsePath,
            stderr,
          },
        }
      }

      const result = JSON.parse(stdout.trim())

      return {
        score: result.reward ?? (result.pass ? 1 : 0),
        pass: result.pass ?? false,
        reasoning: result.message || 'Evaluation completed',
        details: {
          harPath,
          responsePath,
          agentResponseResult: result.details?.agent_response_result,
          networkEventResult: result.details?.network_event_result,
          harEntryCount: har.log.entries.length,
        },
      }
    } catch (error) {
      return {
        score: 0,
        pass: false,
        reasoning: `Grader error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          harPath,
          responsePath,
          error: true,
        },
      }
    }
  }
}

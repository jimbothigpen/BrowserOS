import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight, Lightbulb } from 'lucide-react'
import type { FC } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod/v3'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const ARGUMENTS_TEXT = '-y\nanythingllm-mcp-server@2.0.0'
const ENV_TEXT =
  'ANYTHINGLLM_BASE_URL=http://localhost:3001\nANYTHINGLLM_API_KEY='

const isValidUrl = (value: string) => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

const parseArgsText = (value?: string) =>
  value
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean) ?? []

const parseEnvText = (value?: string): Record<string, string> | undefined => {
  const env: Record<string, string> = {}
  for (const rawLine of value?.split('\n') ?? []) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) return undefined
    const key = line.slice(0, separatorIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined
    env[key] = line.slice(separatorIndex + 1)
  }
  return Object.keys(env).length ? env : undefined
}

const formSchema = z
  .object({
    name: z.string().min(1, 'Server name is required'),
    type: z.enum(['http', 'process']),
    url: z.string().optional(),
    command: z.string().optional(),
    argsText: z.string().optional(),
    envText: z.string().optional(),
    cwd: z.string().optional(),
    description: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.type === 'http') {
      if (!values.url?.trim() || !isValidUrl(values.url.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['url'],
          message: 'Please enter a valid URL',
        })
      }
      return
    }

    if (!values.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'Command is required',
      })
    }

    if (values.envText?.trim() && parseEnvText(values.envText) === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['envText'],
        message: 'Use KEY=value lines',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

type CustomMcpConfig =
  | {
      name: string
      type: 'http'
      url: string
      description: string
    }
  | {
      name: string
      type: 'process'
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      description: string
    }

interface AddCustomMCPDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddServer: (config: CustomMcpConfig) => void
}

export const AddCustomMCPDialog: FC<AddCustomMCPDialogProps> = ({
  open,
  onOpenChange,
  onAddServer,
}) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      type: 'http',
      url: '',
      command: '',
      argsText: '',
      envText: '',
      cwd: '',
      description: '',
    },
  })
  const connectionType = form.watch('type')

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  const onSubmit = (values: FormValues) => {
    if (values.type === 'process') {
      const args = parseArgsText(values.argsText)
      onAddServer({
        name: values.name,
        type: 'process',
        command: values.command?.trim() ?? '',
        args: args.length ? args : undefined,
        env: parseEnvText(values.envText),
        cwd: values.cwd?.trim() || undefined,
        description: values.description ?? '',
      })
    } else {
      onAddServer({
        name: values.name,
        type: 'http',
        url: values.url?.trim() ?? '',
        description: values.description ?? '',
      })
    }
    form.reset()
    onOpenChange(false)
  }

  const applyAnythingLlmPreset = () => {
    form.reset({
      name: 'AnythingLLM',
      type: 'process',
      url: '',
      command: 'npx',
      argsText: ARGUMENTS_TEXT,
      envText: ENV_TEXT,
      cwd: '',
      description: 'Local AnythingLLM MCP agent',
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Custom App</DialogTitle>
          <DialogDescription>
            Configure your custom app connection
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 px-3 py-2">
              <div>
                <p className="font-medium text-sm">AnythingLLM</p>
                <p className="text-muted-foreground text-xs">
                  Local stdio server via npx
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={applyAnythingLlmPreset}
              >
                Use preset
              </Button>
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Server Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Custom App" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Connection Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="http">HTTP URL</SelectItem>
                      <SelectItem value="process">Local Process</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {connectionType === 'http' ? (
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>MCP Server URL</FormLabel>
                    <FormDescription>Streamable HTTP or SSE</FormDescription>
                    <FormControl>
                      <Input
                        type="url"
                        placeholder="http://mcp.example.com/mcp"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="command"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Command</FormLabel>
                      <FormControl>
                        <Input placeholder="npx" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="argsText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Arguments</FormLabel>
                      <FormDescription>One argument per line</FormDescription>
                      <FormControl>
                        <Textarea
                          placeholder={'-y\nanythingllm-mcp-server@2.0.0'}
                          rows={3}
                          className="resize-none font-mono text-xs"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="envText"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Environment</FormLabel>
                      <FormDescription>KEY=value lines</FormDescription>
                      <FormControl>
                        <Textarea
                          placeholder={ENV_TEXT}
                          rows={4}
                          className="resize-none font-mono text-xs"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cwd"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Working Directory (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="C:\\Users\\you" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe what this server does..."
                      rows={3}
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Collapsible>
              <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 rounded-md border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--accent-orange)]/10">
                <Lightbulb className="h-4 w-4 shrink-0 text-[var(--accent-orange)]" />
                <span className="flex-1 font-medium">Connection details</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 rounded-md border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 px-3 py-2 text-muted-foreground text-sm">
                MCP apps usually provide either a URL or a local command with
                arguments and environment variables.
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange-bright)]"
              >
                Add Server
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

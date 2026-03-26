import type { AclRule } from '@browseros/shared/types/acl'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface NewAclRuleDialogProps {
  onSave: (rule: AclRule) => void
  children: React.ReactNode
}

export const NewAclRuleDialog: FC<NewAclRuleDialogProps> = ({
  onSave,
  children,
}) => {
  const [open, setOpen] = useState(false)
  const [sitePattern, setSitePattern] = useState('')
  const [selector, setSelector] = useState('')
  const [textMatch, setTextMatch] = useState('')
  const [description, setDescription] = useState('')

  const reset = () => {
    setSitePattern('')
    setSelector('')
    setTextMatch('')
    setDescription('')
  }

  const handleSave = () => {
    if (!sitePattern.trim()) return
    onSave({
      id: crypto.randomUUID(),
      sitePattern: sitePattern.trim(),
      selector: selector.trim() || undefined,
      textMatch: textMatch.trim() || undefined,
      description: description.trim() || undefined,
      enabled: true,
    })
    reset()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add ACL Rule</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="site-pattern">
              Domain <span className="text-destructive">*</span>
            </Label>
            <Input
              id="site-pattern"
              placeholder="amazon.com"
              value={sitePattern}
              onChange={(e) => setSitePattern(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Matches the domain and all subdomains (e.g. amazon.com matches
              www.amazon.com).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="selector">CSS Selector (optional)</Label>
            <Input
              id="selector"
              placeholder='button, #buy-now, [data-action="pay"]'
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="text-match">Text Match (optional)</Label>
            <Input
              id="text-match"
              placeholder="Place your order"
              value={textMatch}
              onChange={(e) => setTextMatch(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Blocks elements containing this text (case-insensitive).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              placeholder="Block Amazon payments"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!sitePattern.trim()}>
            Add Rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { Coins } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCredits } from '@/lib/credits/useCredits'
import { cn } from '@/lib/utils'

function getCreditColor(credits: number): string {
  if (credits <= 0) return 'text-red-500'
  if (credits <= 30) return 'text-yellow-500'
  return 'text-green-500'
}

function getProgressColor(credits: number): string {
  if (credits <= 0) return 'bg-red-500'
  if (credits <= 30) return 'bg-yellow-500'
  return 'bg-green-500'
}

export const UsagePage: FC = () => {
  const { data, isLoading } = useCredits()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
        Loading usage data...
      </div>
    )
  }

  const credits = data?.credits ?? 0
  const total = 100
  const percentage = Math.min((credits / total) * 100, 100)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-lg">Usage & Billing</h2>
        <p className="text-muted-foreground text-sm">
          Monitor your BrowserOS AI credit usage.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-5 w-5" />
            Credits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className={cn('font-bold text-3xl', getCreditColor(credits))}>
              {credits}
            </span>
            <span className="text-muted-foreground text-sm">/ {total} daily</span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', getProgressColor(credits))}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="space-y-1 text-muted-foreground text-sm">
            <p>1 credit per request</p>
            <p>Resets daily at midnight UTC</p>
            {data?.lastResetAt && (
              <p>Last reset: {new Date(data.lastResetAt).toLocaleDateString()}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Need more credits?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-muted-foreground text-sm">
            Additional credit packages will be available soon.
          </p>
          <Button variant="outline" disabled>
            Add Credits (Coming Soon)
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

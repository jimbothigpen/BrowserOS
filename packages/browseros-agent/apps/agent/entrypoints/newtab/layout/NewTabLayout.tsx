import { ArrowRight } from 'lucide-react'
import type { FC } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { ChatSessionProvider } from '@/entrypoints/sidepanel/layout/ChatSessionContext'
import { NewTabFocusGrid } from './NewTabFocusGrid'
import { shouldHideFocusGrid, shouldUseChatSession } from './route-utils'

interface NewTabLayoutProps {
  useChatSessionOnHome?: boolean
}

export const NewTabLayout: FC<NewTabLayoutProps> = ({
  useChatSessionOnHome = false,
}) => {
  const location = useLocation()
  const hideGrid = shouldHideFocusGrid(location.pathname)
  const useChatSession = shouldUseChatSession(
    location.pathname,
    useChatSessionOnHome,
  )
  const content = (
    <>
      {!hideGrid && <NewTabFocusGrid />}
      <Outlet />
      <NewTabTwoLink />
    </>
  )

  if (!useChatSession) return content

  return <ChatSessionProvider origin="newtab">{content}</ChatSessionProvider>
}

const NewTabTwoLink: FC = () => (
  <Button
    asChild
    variant="ghost"
    size="sm"
    className="fixed right-4 bottom-4 z-50 h-8 gap-1.5 rounded-full bg-white/70 px-3 text-muted-foreground shadow-sm backdrop-blur hover:bg-white"
  >
    <Link to="/newtab-2">
      Try newtab 2
      <ArrowRight className="size-3.5" />
    </Link>
  </Button>
)

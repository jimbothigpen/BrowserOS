import {
  Brain,
  CalendarClock,
  Home,
  PlugZap,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react'
import type { FC } from 'react'
import { NavLink, useLocation } from 'react-router'
import { i18n } from '#i18n'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Feature } from '@/lib/browseros/capabilities'
import { useCapabilities } from '@/lib/browseros/useCapabilities'
import { cn } from '@/lib/utils'

interface SidebarNavigationProps {
  expanded?: boolean
}

type NavItem = {
  nameKey: string
  to: string
  icon: typeof Home
  feature?: Feature
}

const primaryNavItems: NavItem[] = [
  { nameKey: 'sidebar.nav.home', to: '/home', icon: Home },
  {
    nameKey: 'sidebar.nav.connectApps',
    to: '/connect-apps',
    icon: PlugZap,
    feature: Feature.MANAGED_MCP_SUPPORT,
  },
  {
    nameKey: 'sidebar.nav.scheduledTasks',
    to: '/scheduled',
    icon: CalendarClock,
  },
  {
    nameKey: 'sidebar.nav.skills',
    to: '/home/skills',
    icon: Wand2,
    feature: Feature.SKILLS_SUPPORT,
  },
  {
    nameKey: 'sidebar.nav.memory',
    to: '/home/memory',
    icon: Brain,
    feature: Feature.MEMORY_SUPPORT,
  },
  {
    nameKey: 'sidebar.nav.soul',
    to: '/home/soul',
    icon: Sparkles,
    feature: Feature.SOUL_SUPPORT,
  },
  { nameKey: 'sidebar.nav.settings', to: '/settings/ai', icon: Settings },
]

export const SidebarNavigation: FC<SidebarNavigationProps> = ({
  expanded = true,
}) => {
  const location = useLocation()
  const { supports } = useCapabilities()

  const filteredItems = primaryNavItems.filter(
    (item) => !item.feature || supports(item.feature),
  )

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        <nav className="space-y-1">
          {filteredItems.map((item) => {
            const Icon = item.icon
            const isActive =
              item.to === '/settings/ai'
                ? location.pathname.startsWith('/settings')
                : location.pathname === item.to

            const navItem = (
              <NavLink
                to={item.to}
                className={cn(
                  'flex h-9 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md px-3 font-medium text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isActive &&
                    'bg-sidebar-accent text-sidebar-accent-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span
                  className={cn(
                    'truncate transition-opacity duration-200',
                    expanded ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {i18n.t(item.nameKey as never)}
                </span>
              </NavLink>
            )

            if (!expanded) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{navItem}</TooltipTrigger>
                  <TooltipContent side="right">
                    {i18n.t(item.nameKey as never)}
                  </TooltipContent>
                </Tooltip>
              )
            }

            return <div key={item.to}>{navItem}</div>
          })}
        </nav>
      </div>
    </TooltipProvider>
  )
}

import Container from "@/components/container"
import { Separator } from "@/components/ui/base-ui/separator"
import { SidebarTrigger } from "@/components/ui/base-ui/sidebar"
import { cn } from "@/utils/styles/utils"

export function PageLayout({ title, children, className, innerClassName, containerClassName }: { title: React.ReactNode, children: React.ReactNode, className?: string, innerClassName?: string, containerClassName?: string }) {
  return (
    <div className={cn("w-full pb-8", className)}>
      <div className="border-b">
        <Container className={containerClassName}>
          <header className="flex h-14 -ml-1.5 shrink-0 items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-1.5 h-4! my-auto" />
            <h1>{title}</h1>
          </header>
        </Container>
      </div>
      <Container className={cn("@container", containerClassName, innerClassName)}>
        {children}
      </Container>
    </div>
  )
}

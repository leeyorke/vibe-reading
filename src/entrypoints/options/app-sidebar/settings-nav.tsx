import { Icon } from "@iconify/react"
import { Link, useLocation } from "react-router"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/base-ui/sidebar"
import { i18n } from "@/utils/i18n"

export function SettingsNav() {
  const { pathname } = useLocation()

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>{i18n.t("options.sidebar.settings")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/" />} isActive={pathname === "/"}>
                <Icon icon="tabler:adjustments-horizontal" />
                <span>{i18n.t("options.general.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/api-providers" />} isActive={pathname === "/api-providers"}>
                <Icon icon="tabler:api" />
                <span>{i18n.t("options.apiProviders.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/translation" />} isActive={pathname === "/translation"}>
                <Icon icon="ri:translate" />
                <span>{i18n.t("options.translation.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/config" />} isActive={pathname === "/config"}>
                <Icon icon="tabler:settings" />
                <span>{i18n.t("options.config.title")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>学习工具</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/vocabulary" />} isActive={pathname === "/vocabulary"}>
                <Icon icon="tabler:book" />
                <span>生词本</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/flashcards" />} isActive={pathname === "/flashcards"}>
                <Icon icon="tabler:cards" />
                <span>闪卡</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}

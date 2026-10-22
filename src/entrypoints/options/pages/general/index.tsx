import { i18n } from "@/utils/i18n"
import { PageLayout } from "../../components/page-layout"
import AppearanceSettings from "./appearance-settings"
import { BackendService } from "./backend-service"
import { EudicService } from "./eudic-service"
import FeatureProvidersConfig from "./feature-providers-config"
import InterfaceLanguageSettings from "./interface-language-settings"
import { SelectionToolbarSettings } from "./selection-toolbar"

export function GeneralPage() {
  return (
    <PageLayout title={i18n.t("options.general.title")} innerClassName="*:border-b [&>*:last-child]:border-b-0">
      <FeatureProvidersConfig />
      <InterfaceLanguageSettings />
      <AppearanceSettings />
      <SelectionToolbarSettings />
      <BackendService />
      <EudicService />
    </PageLayout>
  )
}

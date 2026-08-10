import { UserCircle, Plug, Database, Blocks, Settings, LayoutGrid } from "lucide-react";

import { register } from "../../lib/registry.ts";
import { ProfileSection } from "./ProfileSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { StorageSection } from "./StorageSection.tsx";
import { PluginsSection } from "./PluginsSection.tsx";
import { SystemSection } from "./SystemSection.tsx";
import { GallerySection } from "./GallerySection.tsx";

register(
  {
    region: "settings",
    id: "profile",
    title: "Profile",
    icon: UserCircle,
    route: "settings/profile",
    order: 0,
    render: () => <ProfileSection />,
  },
  {
    region: "settings",
    id: "providers",
    title: "Providers",
    icon: Plug,
    route: "settings/providers",
    order: 1,
    render: () => <ModelsSection />,
  },
  {
    region: "settings",
    id: "system",
    title: "Settings",
    icon: Settings,
    route: "settings/system",
    order: 2.5,
    render: () => <SystemSection />,
  },
  {
    region: "settings",
    id: "gallery",
    title: "Gallery layouts",
    icon: LayoutGrid,
    route: "settings/gallery",
    order: 2.7,
    render: () => <GallerySection />,
  },
  {
    region: "settings",
    id: "storage",
    title: "Storage",
    icon: Database,
    route: "settings/storage",
    order: 3,
    render: () => <StorageSection />,
  },
  {
    region: "settings",
    id: "plugins",
    title: "Plugins",
    icon: Blocks,
    route: "settings/plugins",
    order: 4,
    render: () => <PluginsSection />,
  },
);

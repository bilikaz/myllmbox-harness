import { useRoute } from "../../lib/router.ts";
import { register } from "../../lib/registry.ts";
import { AgentsPanel } from "./AgentsPanel.tsx";
import { AgentPermissionsPanel } from "./AgentPermissionsPanel.tsx";
import { SubAgentCleanup } from "./SubAgentCleanup.tsx";
import { AgentRunView } from "./AgentRunView.tsx";
import { AgentEditView } from "./AgentEditView.tsx";

function AgentsRoute() {
  const route = useRoute();
  const [, id, mode] = route.split("/");
  if (!id) return null;
  return mode === "edit" ? <AgentEditView id={id} /> : <AgentRunView id={id} />;
}

register(
  { region: "right-panel", id: "agents", order: 1, containers: ["chat", "local"], render: () => <AgentsPanel /> },
  { region: "right-panel", id: "sub-agent-cleanup", order: 2, containers: ["chat", "local"], render: () => <SubAgentCleanup /> },
  { region: "right-panel", id: "agent-permissions", order: 3, containers: ["chat", "local"], render: () => <AgentPermissionsPanel /> },
  { region: "main", id: "agents", route: "agents", render: () => <AgentsRoute /> },
);

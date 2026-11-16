import Workspace from "./workspace";
import { aiConfiguration } from "@/lib/contextual-review";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Workspace ai={aiConfiguration()} />;
}

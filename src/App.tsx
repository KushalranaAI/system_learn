import { Activity, Boxes, Cpu, FlaskConical, Route as RouteIcon, Sparkles } from "lucide-react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { LabPlayer } from "./pages/LabPlayer";
import { LabsPage } from "./pages/LabsPage";
import { LessonPage } from "./pages/LessonPage";
import { PathPage } from "./pages/PathPage";
import { Sandbox } from "./pages/Sandbox";
import { SimPage, SimsPage } from "./pages/SimsPage";
import { MachinePage } from "./pages/MachinePage";
import { AiSettingsPage } from "./pages/AiSettingsPage";
import { useAiActive } from "./ai/settings";
import { useWorkspace } from "./state/workspace";
import { Logo } from "./ui/icons";
import { ChatWidget } from "./chat/ChatWidget";

const LINKS = [
  { to: "/path", label: "Path", icon: RouteIcon },
  { to: "/labs", label: "Labs", icon: FlaskConical },
  { to: "/sandbox", label: "Sandbox", icon: Boxes },
  { to: "/sims", label: "Simulations", icon: Activity },
  { to: "/machine", label: "My machine", icon: Cpu },
];

function Nav() {
  const presenter = useWorkspace((s) => s.presenter);
  const ai = useAiActive();
  if (presenter) return null;
  return (
    <header className="nav">
      <NavLink to="/" className="brand">
        <Logo /> <span>System Learn</span>
      </NavLink>
      <nav>
        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} title={label}>
            <Icon size={16} /> <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <span className="grow" />
      <NavLink to="/ai" className={`ai-chip${ai ? " on" : ""}`} title={ai ? "AI explanations are on" : "Add an AI key for tailored explanations"}>
        <Sparkles size={14} /> <span className="nav-label">{ai ? "AI on" : "Add AI"}</span>
      </NavLink>
    </header>
  );
}

export function App() {
  return (
    <HashRouter>
      <div className="app">
        <Nav />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/path" element={<PathPage />} />
          <Route path="/lesson/:id" element={<LessonPage />} />
          <Route path="/labs" element={<LabsPage />} />
          <Route path="/labs/:slug" element={<LabPlayer />} />
          <Route path="/sandbox" element={<Sandbox />} />
          <Route path="/sims" element={<SimsPage />} />
          <Route path="/sims/:id" element={<SimPage />} />
          <Route path="/machine" element={<MachinePage />} />
          <Route path="/ai" element={<AiSettingsPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
        <ChatWidget />
      </div>
    </HashRouter>
  );
}

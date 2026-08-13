import { LoaderCircle, Zap } from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { InstitutionLogin } from "./components/InstitutionLogin";
import { useInstitution } from "./hooks";

export default function App() {
  const { institution, loading, connect, logout, refresh } = useInstitution();

  if (loading) {
    return <div className="app-loading"><span className="brand-mark"><Zap size={20} /></span><LoaderCircle className="spin-icon" size={24} /><p>Opening secure workspace…</p></div>;
  }

  if (!institution) return <InstitutionLogin onConnect={connect} />;

  return (
    <Dashboard
      institution={institution}
      onConnect={connect}
      onLogout={logout}
      onRefresh={refresh}
    />
  );
}

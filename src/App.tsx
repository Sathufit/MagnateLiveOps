import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { FullMessage } from './components/ui.tsx';
import { api } from './lib/api.ts';
import type { Staff } from './lib/api.ts';
import Board from './pages/Board.tsx';
import { ConsoleShell, OpsList, SignIn } from './pages/Console.tsx';
import OpConsole from './pages/OpConsole.tsx';
import { ConsoleReport, SharedReport } from './pages/Report.tsx';

/** Everything under /console needs a signed-in member of the operations desk. */
function Desk() {
  const [staff, setStaff] = useState<Staff | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then(setStaff, () => setStaff({ name: null, channel: null }));
  }, []);

  if (staff === undefined) return <div className="loading" role="status">Loading</div>;
  if (staff.name === null) return <SignIn onSignedIn={setStaff} />;

  const signOut = () => {
    void api.logout().finally(() => {
      setStaff({ name: null, channel: null });
      navigate('/console');
    });
  };

  return (
    <Routes>
      <Route path="ops/:id/report" element={<ConsoleReport />} />
      <Route element={<ConsoleShell staff={staff.name} channel={staff.channel} onSignOut={signOut} />}>
        <Route index element={<OpsList />} />
        <Route path="ops/:id" element={<OpConsole />} />
      </Route>
      <Route path="*" element={<Navigate to="/console" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/console" replace />} />
      <Route path="/console/*" element={<Desk />} />
      <Route path="/live/:token" element={<Board />} />
      <Route path="/live/:token/report" element={<SharedReport />} />
      <Route
        path="*"
        element={
          <FullMessage title="Page not found">
            <p>If you were sent a link to follow an operation, please check it was copied in full.</p>
          </FullMessage>
        }
      />
    </Routes>
  );
}

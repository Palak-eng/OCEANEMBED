import { Link, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  BellRing,
  GraduationCap,
  Home,
  LayoutGrid,
  LogOut,
  MapPin,
  Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function AuthControls() {
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user.email ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!email) {
    return (
      <Button asChild size="sm" variant="secondary">
        <Link to="/auth">Sign in</Link>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">
        {email}
      </span>
      <Button size="sm" variant="secondary" className="gap-1.5" onClick={signOut}>
        <LogOut className="size-3.5" /> Sign out
      </Button>
    </div>
  );
}

const TABS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/map", label: "Map", icon: MapPin },
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/learn", label: "Kids", icon: GraduationCap },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function TopNav() {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-border bg-panel px-5 py-3 backdrop-blur-md">
      <Link to="/" className="flex items-center gap-3">
        <img
          src="/logo.png"
          alt="OceanEmbed logo"
          width={40}
          height={40}
          className="size-10 rounded-full object-cover ring-1 ring-primary/40"
        />
        <span className="font-display text-xl font-bold tracking-tight">
          OCEAN<span className="text-accent">EMBED</span>
        </span>
      </Link>
      <nav className="ml-auto flex items-center gap-1">
        {TABS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            activeProps={{ className: "bg-primary/25 !text-foreground ring-1 ring-primary/40" }}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
      </nav>
      <AuthControls />
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="p-4">{children}</main>
    </div>
  );
}

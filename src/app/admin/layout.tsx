import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { sessionIsAdmin } from "@/lib/supabase/admin-access";
import { supabaseConfigured } from "@/lib/supabase/env";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) redirect("/login?next=/admin");
  const supabase = await createServerSupabase();
  if (!supabase) redirect("/login?next=/admin");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  if (!sessionIsAdmin(user)) redirect("/");

  return <>{children}</>;
}

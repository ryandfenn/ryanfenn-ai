import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) redirect("/login?next=/billing");
  const supabase = await createServerSupabase();
  if (!supabase) redirect("/login?next=/billing");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/billing");

  return <>{children}</>;
}

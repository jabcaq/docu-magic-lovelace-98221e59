import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's token to verify they're admin
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is admin
    const { data: roleData } = await supabaseUser.from("user_roles").select("role").eq("user_id", user.id).single();
    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client to fetch all users
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get all user roles
    const { data: userRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("*")
      .order("created_at", { ascending: false });

    if (rolesError) {
      throw rolesError;
    }

    // Fetch emails for each user
    const usersWithEmails = await Promise.all(
      userRoles.map(async (userRole) => {
        const { data: { user: authUser } } = await supabaseAdmin.auth.admin.getUserById(userRole.user_id);
        return {
          id: userRole.user_id,
          email: authUser?.email || "Unknown",
          role: userRole.role,
          created_at: userRole.created_at,
        };
      })
    );

    return new Response(JSON.stringify({ users: usersWithEmails }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

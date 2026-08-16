// ========================================================
//  HI HA DE TOT — Edge Function: send-push
//  Desplegar a: supabase/functions/send-push/index.ts
//
//  Secrets necessaris a Supabase Dashboard → Settings → Edge Functions:
//    VAPID_PUBLIC_KEY   = BCJqlUOyxvM0UvZDLjix7tx-6fj5J1pMMuBMzNRJJO4Nc7OWvvhrae6mTMBWgTapmZEksUexw4Q_zZTQANldEDc
//    VAPID_PRIVATE_KEY  = P9_tZI4AavNnCnQ2G87we-FyoSXQMT7fE-OoFd1F7QU
//    VAPID_SUBJECT      = mailto:rtorpatilla@gmail.com
// ========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @deno-types="npm:@types/web-push"
import webpush from "npm:web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, title, body, url, tag } = await req.json();

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Obtenir totes les subscripcions de l'usuari
    const { data: subs, error } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", user_id);

    if (error || !subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({ title, body, url: url || "/", tag: tag || "hihadetot" });

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    // Netejar subscripcions mortes (endpoint ja no vàlid)
    const deadEndpoints: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const err = (r as PromiseRejectedResult).reason;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          deadEndpoints.push(subs[i].endpoint);
        }
      }
    });
    if (deadEndpoints.length > 0) {
      await sb.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
    }

    return new Response(JSON.stringify({ sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

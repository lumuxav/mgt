import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2.116.0"
import { createEmailDispatchHandler } from "./handler.js"

Deno.serve(createEmailDispatchHandler({
  createClient,
  env: Deno.env,
}))

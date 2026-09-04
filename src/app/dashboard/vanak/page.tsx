import { redirect } from "next/navigation";

// Vanak Drop artık bağımsız /vanak route'unda (admin login gerektirmez, sadece
// access-key). Eski dashboard alt yolu buraya yönlendirir.
export default function DashboardVanakRedirect() {
  redirect("/vanak");
}

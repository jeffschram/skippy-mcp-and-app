import { redirect } from "next/navigation";

export default function Page() {
  // The memory inbox merged into the Review queue's Finds section (Sep 4).
  redirect("/review?filter=finds");
}

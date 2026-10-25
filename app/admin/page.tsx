import type { Metadata } from "next";
import Phones from "./Phones";
import s from "./admin.module.css";

export const metadata: Metadata = { title: "Admin · Belugo" };

export default function AdminPage() {
  return (
    <main className={s.page}>
      <header>
        <h1 className={s.title}>Admin</h1>
        <p className={s.lead}>
          Manage the listening phones: how each one gives its location, what it shows, and its calibration. Phones pick
          up changes within a few seconds.
        </p>
      </header>
      <Phones />
    </main>
  );
}

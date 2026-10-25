import Link from "next/link";
import Logo from "./components/Logo";
import Sonar from "./components/Sonar";
import s from "./landing.module.css";

const STEPS = [
  {
    n: "01",
    title: "Listen on the phone",
    text: "Each participating phone opens a web page and presses Start listening. An AudioWorklet watches the microphone for a sudden, sharp spike, and the audio is analyzed on the phone itself.",
    note: "Web Audio · AudioWorklet",
  },
  {
    n: "02",
    title: "Report a timestamp, not a recording",
    text: "When a phone hears a bang it sends four facts: who it is, when it heard it, how loud it was and how sure it is. The clock is synced to the server every minute, so timestamps from different phones line up.",
    note: "{ deviceId, localSpikeTsMs, peakDb, confidence }",
  },
  {
    n: "03",
    title: "Solve for the origin",
    text: "Sound covers about a meter every 2.9 ms and gets 6 dB quieter each time the distance doubles. The server scores every cell of the floor plan by how well it explains each phone's arrival time and loudness, and keeps the best fit.",
    note: "grid search · lib/localize.ts",
  },
  {
    n: "04",
    title: "Tell the whole building",
    text: "Within seconds the incident dashboard shows the estimated room, and every listening phone gets the alert. People can answer with one tap: safe, need help or injured, so responders know where to go first.",
    note: "Supabase Realtime",
  },
];

const FIGURES = [
  { value: "343", unit: "m/s", text: "The speed of sound, the constant everything is solved against." },
  { value: "±300", unit: "ms", text: "The window that groups separate phones' reports into a single shot." },
  { value: "3+", unit: "phones", text: "Enough to settle the location: two phones leave a mirror-image ambiguity." },
  { value: "0", unit: "bytes", text: "Of audio ever leaves the phone. No recordings, no voices, just three numbers." },
];

export default function Landing() {
  return (
    <div className={s.root}>
      <header className={s.header}>
        <Link href="/" className={s.wordmark} aria-label="Belugo home">
          <Logo size={26} />
          belugo
        </Link>
        <nav className={s.headerNav} aria-label="Sections">
          <a href="#method">Method</a>
          <Link href="/docs">Docs</Link>
          <Link href="/spaces" className={s.headerCta}>
            Live demo
          </Link>
        </nav>
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.kicker} role="marquee" aria-label="HackTX 2026, Save Lives, Prototype at belugo.tech">
            {/* Two identical halves: the track slides left by one half, then loops seamlessly. */}
            <div className={s.tickerTrack} aria-hidden="true">
              {Array.from({ length: 2 }, (_, half) => (
                <div key={half} className={s.tickerHalf}>
                  {Array.from({ length: 4 }, (_, i) => (
                    <span key={i} className={s.tickerGroup}>
                      <span>HackTX 2026</span>
                      <span>Save Lives</span>
                      <span className={s.live}>
                        <i /> Prototype @ belugo.tech
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <h1 className={s.headline}>
            Locate gunfire
            <br />
            <em>in seconds.</em>
          </h1>

          <div className={s.heroBody}>
            <p className={s.lead}>
              Belugo unites the phones already present in a school&apos;s classrooms into a single acoustic sensor
              network. The moment a gunshot rings out, it triangulates the likely origin by comparing{" "}
              <b>when</b> and <b>how loudly</b> each device heard it, assisting first responders in locating and neutralizing the threat.
            </p>
            <div className={s.heroActions}>
              <Link href="/spaces" className={s.primaryBtn}>
                Run the live demo <span aria-hidden="true">→</span>
              </Link>
              <a href="#method" className={s.textLink}>
                How it works
              </a>
            </div>
          </div>

          <Sonar />
        </section>

        <section className={s.problem}>
          <p className={s.problemLabel}>The problem</p>
          <p className={s.problemText}>
            Every minute a shooter goes unlocated is a minute responders spend searching. Calls conflict. Hallways
            echo. Rooms get cleared one by one.{" "}
            <span>
              Belugo listens like its namesake: every phone in the building works together to pinpoint the
              shooter&apos;s location.
            </span>
          </p>
        </section>

        <section id="method" className={s.method}>
          <div className={s.sectionHead}>
            <p className={s.sectionLabel}>§ 1 · Method</p>
            <h2 className={s.sectionTitle}>
              Four steps,
              <br />
              <em>one shared picture.</em>
            </h2>
          </div>
          <ol className={s.ledger}>
            {STEPS.map((step) => (
              <li key={step.n}>
                <span className={s.ledgerNum}>{step.n}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                <code className={s.ledgerNote}>{step.note}</code>
              </li>
            ))}
          </ol>
        </section>

        <section className={s.figures} aria-label="Key figures">
          {FIGURES.map((f) => (
            <div key={f.value} className={s.fig}>
              <p className={s.figValue}>
                {f.value}
                <span>{f.unit}</span>
              </p>
              <p className={s.figText}>{f.text}</p>
            </div>
          ))}
        </section>

        <section className={s.judges} id="demo">
          <div className={s.judgesInner}>
            <p className={s.sectionLabelInv}>§ 2 · For judges</p>
            <h2 className={s.judgesTitle}>
              See it work in
              <br />
              <em>three minutes.</em>
            </h2>
            <ol className={s.route}>
              <li>
                <span className={s.routeTime}>0:00</span>
                <b>Start a private demo space.</b> You get your own sandbox and a QR code, so other judges&apos; tests
                never mix with yours.
              </li>
              <li>
                <span className={s.routeTime}>0:30</span>
                <b>Add three phones.</b> Scan the QR code with your phone, or open three browser tabs and put each one
                in a different room.
              </li>
              <li>
                <span className={s.routeTime}>1:30</span>
                <b>Clap, or press Simulate shot.</b> Watch the dashboard mark the room, while every phone receives the
                alert.
              </li>
            </ol>
            <div className={s.judgesActions}>
              <Link href="/spaces" className={s.invBtn}>
                Open the live demo <span aria-hidden="true">→</span>
              </Link>
              <Link href="/docs" className={s.invLink}>
                How it works
              </Link>
              <Link href="/incident" className={s.invLink}>
                Incident dashboard
              </Link>
            </div>
          </div>
        </section>

      </main>

      <footer className={s.footer}>
        <div className={s.footerRow}>
          <p>
            Named for the beluga, the whale that finds its way by listening.
            <br />
            Built at HackTX 2026.
          </p>
          <nav className={s.footerNav} aria-label="Footer">
            <Link href="/spaces">Live demo</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/incident">Dashboard</Link>
            <Link href="/phone">Phone listener</Link>
            <a href="https://github.com/bear102/hacktx-26" target="_blank" rel="noreferrer">
              Source on GitHub ↗
            </a>
          </nav>
        </div>
        <p className={s.giant} aria-hidden="true">
          belugo
        </p>
      </footer>
    </div>
  );
}

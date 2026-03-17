"use client";

import Image, { type ImageProps } from "next/image";
import Link from "next/link";

import { Card, CardBody, Divider } from "@heroui/react";

import { ParticleCursorField } from "@/app/components/landing/particle-cursor-field";
import { SectionHeader } from "@/app/components/landing/section-header";
import { config } from "@/app/lib/config";
import arcdiag from "@/arcdiag.png";

import styles from "@/app/page.module.css";

type SectionIllustration = {
  src: ImageProps["src"];
  alt: string;
  caption: string;
  priority?: boolean;
};

const sectionIllustrations = {
  protocol: {
    src: "/illustrations/protocol-ethereum.svg",
    alt: "Abstract blockchain network visualization for CoverFi architecture",
    caption: "Wallet, x402, a relay-backed quote engine, and onchain contracts running in one deterministic flow.",
    priority: true,
  },
  audience: {
    src: "/illustrations/audience-business-plan.svg",
    alt: "Community and creator teams planning event operations",
    caption: "Built for indie operators who commit budget before showtime.",
  },
  flow: {
    src: "/illustrations/flow-product-explainer.svg",
    alt: "Three-step quote mint claim flow",
    caption: "Quote terms, mint policy, settle outcome.",
  },
  tech: {
    src: arcdiag,
    alt: "Network-style visualization for open onchain state",
    caption: "No hidden mutable backend policy ledger deciding outcomes.",
  },
} satisfies Record<string, SectionIllustration>;

const stackChips = [
  "Relay-backed execution",
  "x402 pay-to-access",
  "USDC reserves",
  "Soulbound Policy NFT",
  "Event data + AI risk checks",
] as const;

const heroSignals = [
  {
    label: "Flow",
    value: "3-step cover lifecycle",
  },
  {
    label: "Settlement",
    value: "Deterministic PAY / RESOLVE",
  },
  {
    label: "Trust Model",
    value: "Onchain state, no black-box DB",
  },
] as const;

const howItHits = [
  {
    tag: "Before event",
    title: "Lock your numbers",
    description: "Get premium + payout terms up front so your downside is clear before doors open.",
  },
  {
    tag: "During event",
    title: "Hold active cover",
    description: "Mint your policy NFT and keep your cover state tied to your wallet, not a hidden backend row.",
  },
  {
    tag: "After event",
    title: "Settle onchain",
    description: "If cancellation rules hit, settlement routes to payout. If not, liability resolves cleanly.",
  },
] as const;

const audienceProfiles = [
  "Independent promoters",
  "Wedding and private event planners",
  "Community festival crews",
] as const;

const lossVectors = [
  "Venue and vendor deposits",
  "Artist and speaker retainers",
  "Paid marketing campaigns",
] as const;

const stackSpotlight = [
  {
    title: "x402 (Primary Access Rail)",
    description:
      "Paid endpoint access for quote, mint, and claim so usage is machine-readable, metered, and agent-friendly.",
  },
  {
    title: "Relay Executor (Primary Execution Layer)",
    description:
      "Runs deterministic quote, mint, and claim checks in Next.js and relays settlement reports onchain.",
  },
  {
    title: "AI + Pricing Engine",
    description:
      "Blends AI risk signals with deterministic pricing math to produce fair premium and payout quotes.",
  },
  {
    title: "PolicyNFT",
    description: "Soulbound policy ownership so claim rights stay tied to the insured wallet.",
  },
  {
    title: "PolicyVault",
    description: "USDC reserve engine enforcing solvency and payout accounting.",
  },
  {
    title: "Base Sepolia",
    description: "Execution network where policy state and settlement receipts live.",
  },
] as const;

const workflowSteps = [
  {
    title: "Get Quote",
    description:
      "Drop your event URL and tier. AI risk signals + pricing math return a fair premium and payout in seconds.",
  },
  {
    title: "Mint Cover",
    description: "Use the approved quote to mint your policy NFT and activate protection.",
  },
  {
    title: "Claim Outcome",
    description: "Run claim settlement and get a deterministic payout, resolve, or pending result.",
  },
] as const;

const HOW_IT_HITS_VIDEO_EMBED_URL = "https://www.youtube.com/embed/QnkSvXrcPig";

function SectionVisualCard({ illustration }: { illustration: SectionIllustration }) {
  return (
    <figure className={styles.sectionVisualCard}>
      <Image
        src={illustration.src}
        alt={illustration.alt}
        width={560}
        height={360}
        className={styles.sectionVisualImage}
        priority={Boolean(illustration.priority)}
      />
      <figcaption className={styles.sectionVisualCaption}>{illustration.caption}</figcaption>
    </figure>
  );
}

function SectionVideoCard({ embedUrl, caption }: { embedUrl: string; caption: string }) {
  return (
    <figure className={styles.sectionVisualCard}>
      <div className={styles.sectionVideoFrame}>
        <iframe
          src={embedUrl}
          title="CoverFi How It Hits Demo Video"
          className={styles.sectionVideoEmbed}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <figcaption className={styles.sectionVisualCaption}>{caption}</figcaption>
    </figure>
  );
}

export function LandingPageClient() {
  const receiverUrl = config.policyReceiver ? `${config.basescan}/address/${config.policyReceiver}` : config.basescan;
  const policyNftUrl = config.policyNft ? `${config.basescan}/address/${config.policyNft}` : config.basescan;
  const policyVaultUrl = config.policyVault ? `${config.basescan}/address/${config.policyVault}` : config.basescan;

  return (
    <main className={styles.page}>
      <ParticleCursorField className={styles.particleLayer} />

      <div className={styles.content}>
        <section className={`${styles.panel} ${styles.heroPanel}`}>
          <p className={styles.heroEyebrow}>Web3 Event Cover</p>
          <h1 className={styles.heroTitle}>Protect your event budget onchain.</h1>
          <p className={styles.heroDescription}>
            Quote it. Mint it. Claim it. If your event gets canceled, your coverage settles transparently on Base
            Sepolia.
          </p>
          <p className={styles.heroPositionLine}>
            Don&apos;t just gamble, insure. Protect against event risk without betting on outcomes.
          </p>

          <div className={styles.stackChipRow}>
            {stackChips.map((chip) => (
              <span key={chip} className={styles.stackChip}>
                {chip}
              </span>
            ))}
          </div>

          <p className={styles.heroMicro}>Built for indie organizers, collectives, and creator crews.</p>

          <div className={styles.ctaRow}>
            <Link href="/app">
              <button type="button" className={styles.ctaGradient}>
                Launch App
                <span className={styles.ctaArrow}>→</span>
              </button>
            </Link>
            <a href={receiverUrl} className={styles.ctaOutline} target="_blank" rel="noreferrer">
              See Contracts
            </a>
          </div>

          <div className={styles.heroSignalGrid}>
            {heroSignals.map((item) => (
              <Card key={item.label} className={styles.heroSignalCard}>
                <CardBody className={styles.heroSignalBody}>
                  <p className={styles.heroSignalLabel}>{item.label}</p>
                  <p className={styles.heroSignalValue}>{item.value}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="How It Hits"
                title="Fast cover flow for real-world event risk"
                description="No giant process deck. Just clear terms before the event, wallet-owned policy state during, and deterministic settlement after."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <div className={styles.hitGrid}>
                {howItHits.map((item) => (
                  <Card key={item.tag} className={styles.hitCard}>
                    <CardBody className={styles.centerCardBody}>
                      <p className={styles.hitTag}>{item.tag}</p>
                      <h3 className={styles.hitTitle}>{item.title}</h3>
                      <p className={styles.hitDescription}>{item.description}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>

            <SectionVideoCard
              embedUrl={HOW_IT_HITS_VIDEO_EMBED_URL}
              caption="Watch the CoverFi quote-to-claim flow in action."
            />
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Who It Is For"
                title="Made for people actually running events"
                description="If your crew fronts money before showtime, this helps cap cancellation downside."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />
              <p className={styles.eventbriteNote}>Works with any Eventbrite event URL.</p>

              <h3 className={styles.sectionSubtitle}>Audience</h3>
              <div className={styles.cardGrid}>
                {audienceProfiles.map((profile) => (
                  <Card key={profile} className={styles.neoCard}>
                    <CardBody className={styles.centerCardBody}>
                      <p className={styles.neoCardTitle}>{profile}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <h3 className={styles.sectionSubtitle}>What you&apos;re protecting</h3>
              <div className={styles.cardGrid}>
                {lossVectors.map((vector) => (
                  <Card key={vector} className={styles.neoCard}>
                    <CardBody className={styles.centerCardBody}>
                      <p className={styles.neoCardTitle}>{vector}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>

            <SectionVisualCard illustration={sectionIllustrations.audience} />
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Stack Spotlight"
                title="x402 + a direct relay power the core loop"
                description="CoverFi is designed for AI-agent use: deterministic paid APIs, a server-side quote engine, and onchain settlement."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <div className={styles.cardGrid}>
                {stackSpotlight.map((item) => (
                  <Card key={item.title} className={styles.neoCard}>
                    <CardBody>
                      <h3 className={styles.neoCardTitle}>{item.title}</h3>
                      <p className={styles.neoCardBody}>{item.description}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <p className={styles.stackLine}>No black-box backend state deciding policy outcomes.</p>
            </div>

            <SectionVisualCard illustration={sectionIllustrations.tech} />
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Quote / Mint / Claim"
                title="Three moves from quote to settlement"
                description="Simple user flow. Deterministic contract outcomes."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <div className={styles.workflowGrid}>
                {workflowSteps.map((step, index) => (
                  <Card key={step.title} className={styles.workflowCard}>
                    <CardBody>
                      <div className={styles.workflowIndex}>{index + 1}</div>
                      <h3 className={styles.workflowTitle}>{step.title}</h3>
                      <p className={styles.workflowDescription}>{step.description}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <div className={styles.ctaRow}>
                <Link href="/app">
                  <button type="button" className={styles.ctaGradient}>
                    Open Workflow Console
                    <span className={styles.ctaArrow}>→</span>
                  </button>
                </Link>
              </div>
            </div>

            <SectionVisualCard illustration={sectionIllustrations.flow} />
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerGrid}>
            <div>
              <h2 className={styles.footerTitle}>Product</h2>
              <div className={styles.footerLinks}>
                <Link href="/app" className={styles.footerLink}>
                  Launch App
                </Link>
                <Link href="/app" className={styles.footerLink}>
                  Quote / Mint / Claim Console
                </Link>
              </div>
            </div>

            <div>
              <h2 className={styles.footerTitle}>Contracts</h2>
              <div className={styles.footerLinks}>
                <a href={receiverUrl} target="_blank" rel="noreferrer" className={styles.footerLink}>
                  PolicyReceiver
                </a>
                <a href={policyNftUrl} target="_blank" rel="noreferrer" className={styles.footerLink}>
                  PolicyNFT
                </a>
                <a href={policyVaultUrl} target="_blank" rel="noreferrer" className={styles.footerLink}>
                  PolicyVault
                </a>
              </div>
            </div>

            <div>
              <h2 className={styles.footerTitle}>Docs</h2>
              <div className={styles.footerLinks}>
                <a
                  href="https://docs.cdp.coinbase.com/x402/docs/welcome"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.footerLink}
                >
                  x402
                </a>
                <a href={config.basescan} target="_blank" rel="noreferrer" className={styles.footerLink}>
                  BaseScan
                </a>
              </div>
            </div>
          </div>

          <Divider className={styles.softDivider} />

          <p className={styles.footerMeta}>
            Base Sepolia demo. Built as an indie prototype for educational use, not financial advice.
          </p>
        </footer>
      </div>
    </main>
  );
}

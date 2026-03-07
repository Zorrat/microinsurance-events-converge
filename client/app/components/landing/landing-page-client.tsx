"use client";

import Image from "next/image";
import Link from "next/link";

import { Button, Card, CardBody, Chip, Divider } from "@heroui/react";

import { FeatureCard } from "@/app/components/landing/feature-card";
import { FlowStep } from "@/app/components/landing/flow-step";
import { ParticleCursorField } from "@/app/components/landing/particle-cursor-field";
import { SectionHeader } from "@/app/components/landing/section-header";
import { config } from "@/app/lib/config";
import {
  WORKFLOW_LANDING_FLOW,
  WORKFLOW_STAGE_CONTENT,
} from "@/app/lib/workflow-content";

import styles from "@/app/page.module.css";

type SectionIllustration = {
  src: string;
  alt: string;
  caption: string;
  priority?: boolean;
};

const sectionIllustrations = {
  protocolPrimary: {
    src: "/illustrations/protocol-ethereum.svg",
    alt: "Abstract blockchain network illustration representing protocol orchestration",
    caption: "Decentralized orchestration across wallet, x402 gateway, CRE, and onchain settlement.",
    priority: true,
  },
  protocolSecondary: {
    src: "/illustrations/protocol-security.svg",
    alt: "Security themed illustration representing guarded routing",
    caption: "Forwarder-gated report delivery and controlled state transitions.",
  },
  features: {
    src: "/illustrations/features-analytics.svg",
    alt: "Analytics interface illustration representing micro-parameterized policy decisions",
    caption: "Deterministic quote and settlement behavior anchored to transparent inputs.",
  },
  audience: {
    src: "/illustrations/audience-business-plan.svg",
    alt: "Business planning illustration for operators managing event risk",
    caption: "Built for teams committing spend before event outcomes are known.",
  },
  flow: {
    src: "/illustrations/flow-product-explainer.svg",
    alt: "Workflow process illustration for quote, mint, and claim lifecycle",
    caption: "Three-stage lifecycle: quote, mint policy NFT, claim settlement outcome.",
  },
  decentralized: {
    src: "/illustrations/decentralized-data-points.svg",
    alt: "Connected data points illustration showing transparency and auditability",
    caption: "Open verification path across contract events, policy state, and vault accounting.",
  },
  guardrails: {
    src: "/illustrations/guardrails-safe.svg",
    alt: "Safety illustration representing protocol guardrails and risk controls",
    caption: "Protocol guardrails constrain invalid transitions and payout paths.",
  },
} satisfies Record<string, SectionIllustration>;

const overviewSteps = [
  {
    title: "User Wallet",
    description: "MetaMask signs the paid API call and receives typed quote, mint, and claim responses.",
  },
  {
    title: "x402-Protected API",
    description: "Quote, buy, and claim requests are metered via x402 so execution is explicit and auditable.",
  },
  {
    title: "CRE Workflow",
    description: "A single workflow coordinates deterministic quote checks, mint routing, and claim decisions.",
  },
  {
    title: "PolicyNFT + PolicyVault",
    description: "Policy ownership and reserve-backed liability accounting are enforced on Base Sepolia.",
  },
];

const featureCards = [
  {
    title: "Micro-parameterized insurance",
    description:
      "Coverage windows, payout, premium, and event identity are policy-level parameters that can be quoted per event risk profile.",
  },
  {
    title: "Nontransferable policy NFT",
    description:
      "Policies are soulbound ERC-721 positions. Transfer and approval paths are blocked, preserving ownership-linked claim rights.",
  },
  {
    title: "Instant settlement path",
    description:
      "Claims resolve through deterministic PAY or RESOLVE report actions routed by CREReceiver to PolicyNFT and PolicyVault.",
  },
];

const audienceProfiles = [
  { title: "Event organizers" },
  { title: "Promoters" },
  { title: "Venues" },
  { title: "Talent managers" },
];

const lossVectors = [
  { title: "Vendor deposits" },
  { title: "Marketing spend" },
  { title: "Staffing and operations" },
  { title: "Travel and logistics" },
  { title: "Committed talent guarantees" },
];

const executionFlow = [
  {
    title: "Quote",
    description: "Collect event inputs, run deterministic checks, and return signed quote terms that can be minted.",
  },
  {
    title: "Buy / Mint",
    description: "Submit the signed quote, pass reserve and integrity checks, and mint an active nontransferable policy NFT.",
  },
  {
    title: "Claim",
    description: "Check event cancellation status against policy context and resolve onchain to PAY or RESOLVE deterministically.",
  },
];


const guardrails = [
  "Forwarder-gated onReport entrypoint on CREReceiver.",
  "Signed quote verification with expiry and anti-replay assumptions.",
  "Soulbound policy NFT with transfer and approval paths disabled.",
  "Reserve ratio solvency checks before liability increases.",
  "Monotonic policy lifecycle (ACTIVE -> PAID or RESOLVED_NO_PAYOUT).",
  "Claim payout target tied to policy ownership rules.",
];

const designDecisions = [
  "Single workflow with three actions: QUOTE_CHECK, MINT, CLAIM.",
  "Minimal receiver: underwriting remains offchain while state transitions are enforced onchain.",
  "No mutable backend database for policy state or reserve accounting.",
  "Landing information architecture prioritizes operational clarity over dense protocol prose.",
];

function SectionVisualCard({ illustration, compact = false }: { illustration: SectionIllustration; compact?: boolean }) {
  return (
    <figure className={`${styles.sectionVisualCard} ${compact ? styles.sectionVisualCardCompact : ""}`.trim()}>
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

export function LandingPageClient() {
  const receiverUrl = config.creReceiver ? `${config.basescan}/address/${config.creReceiver}` : config.basescan;
  const policyNftUrl = config.policyNft ? `${config.basescan}/address/${config.policyNft}` : config.basescan;
  const policyVaultUrl = config.policyVault ? `${config.basescan}/address/${config.policyVault}` : config.basescan;

  return (
    <main className={styles.page}>
      <ParticleCursorField className={styles.particleLayer} />

      <div className={styles.content}>
        <section className={`${styles.panel} ${styles.heroPanel}`}>
          <h1 className={styles.heroTitle}>CoverFi</h1>
          <p className={styles.heroDescription}>
            On-chain event cancellation micro-insurance. Get a quote, buy coverage, and claim payouts — all
            settled transparently through smart contracts.
          </p>

          <div className={styles.ctaRow}>
            <Link href="/app">
              <button type="button" className={styles.ctaGradient}>
                Launch App
                <span className={styles.ctaArrow}>→</span>
              </button>
            </Link>
            <a
              href={receiverUrl}
              className={styles.ctaOutline}
              target="_blank"
              rel="noreferrer"
            >
              View on Explorer
            </a>
          </div>


        </section>

        <section className={`${styles.panel} ${styles.overviewPanel}`}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Protocol Overview"
                title="Wallet -> x402 API -> CRE -> Receiver -> Onchain Policy Engine"
                description="Policy state and reserve accounting stay in contracts, while CRE routes deterministic workflow actions."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <div className={styles.architecturePlaceholder}>
                <div className={styles.architecturePlaceholderInner}>
                  <p className={styles.architectureTag}>Architecture Diagram Placeholder</p>
                  <h3 className={styles.architecturePlaceholderTitle}>Reserved for final end-to-end architecture visual</h3>
                  <p className={styles.architecturePlaceholderHint}>
                    This space is reserved for the final system diagram that will show control flow, payment flow, and
                    settlement flow in one canonical view.
                  </p>
                </div>
              </div>

              <div className={styles.architectureExplanation}>
                <ul className={styles.list}>
                  <li>Request path: wallet signs paid call and triggers deterministic workflow action.</li>
                  <li>Report path: forwarder-gated receiver validates and routes action outputs.</li>
                  <li>Settlement path: PolicyNFT and PolicyVault enforce final PAY/RESOLVE transitions.</li>
                </ul>
                <p className={styles.architecturePlaceholderHint}>
                  Final diagram will focus on action boundaries, contract writes, and payout ownership.
                </p>
              </div>
            </div>

            <div className={styles.visualStack}>
              <SectionVisualCard illustration={sectionIllustrations.protocolPrimary} />
              <SectionVisualCard illustration={sectionIllustrations.protocolSecondary} compact />
            </div>
          </div>



          <div className={styles.overviewCardGrid}>
            {overviewSteps.map((item, index) => (
              <Card key={item.title} className={styles.overviewStepCard}>
                <CardBody>
                  <div className={styles.overviewStepIndex}>{String(index + 1).padStart(2, "0")}</div>
                  <h3 className={styles.overviewStepTitle}>{item.title}</h3>
                  <p className={styles.overviewStepDescription}>{item.description}</p>
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
                eyebrow="Features"
                title="Coverage primitives designed for event cancellation risk"
                description="The protocol is built around deterministic quoting, soulbound policy ownership, and direct settlement transitions."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <div className={styles.overviewCardGrid}>
                {featureCards.map((feature) => (
                  <Card key={feature.title} className={styles.overviewStepCard}>
                    <CardBody>
                      <h3 className={styles.overviewStepTitle}>{feature.title}</h3>
                      <p className={styles.overviewStepDescription}>{feature.description}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>

            <SectionVisualCard illustration={sectionIllustrations.features} />
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Who It Is For"
                title="Teams exposed to cancellation risk before revenue is realized"
                description="CoverFi targets participants that commit budget before event outcomes are known."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <h3 className={styles.sectionSubtitle}>Primary users</h3>
              <div className={styles.overviewCardGrid}>
                {audienceProfiles.map((item) => (
                  <Card key={item.title} className={styles.overviewStepCard}>
                    <CardBody>
                      <h3 className={styles.overviewStepTitle} style={{ marginBottom: 0 }}>
                        {item.title}
                      </h3>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <h3 className={styles.sectionSubtitle} style={{ marginTop: "1.25rem" }}>Loss vectors this helps hedge</h3>
              <div className={styles.overviewCardGrid}>
                {lossVectors.map((item) => (
                  <Card key={item.title} className={styles.overviewStepCard}>
                    <CardBody>
                      <h3 className={styles.overviewStepTitle} style={{ marginBottom: 0 }}>
                        {item.title}
                      </h3>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <div className={styles.logicExplanationBox}>
                <p className={styles.logicExplanationLabel}>Hedging logic</p>
                <p className={`${styles.bodyCopy} ${styles.logicExplanationCopy}`}>
                  Premium locks payout terms before the event window. If cancellation criteria are met the workflow
                  routes PAY; otherwise liability is closed through RESOLVE.
                </p>
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
                eyebrow="Buy / Mint / Claim"
                title="Operator workflow"
                description="Three actions drive the lifecycle from signed quote terms to final settlement status."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <div className={styles.overviewCardGrid}>
                {executionFlow.map((step, index) => (
                  <Card key={step.title} className={styles.overviewStepCard}>
                    <CardBody>
                      <div className={styles.overviewStepIndex}>{index + 1}</div>
                      <h3 className={styles.overviewStepTitle}>{step.title}</h3>
                      <p className={styles.overviewStepDescription}>{step.description}</p>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <div className={styles.policyLogicBox}>
                <p className={styles.logicExplanationLabel}>Policy flow logic</p>
                <p className={`${styles.bodyCopy} ${styles.logicExplanationCopy}`}>
                  {WORKFLOW_STAGE_CONTENT.quote.navTitle} issues signed terms,{" "}
                  {WORKFLOW_STAGE_CONTENT.buy.navTitle} commits policy ownership, and{" "}
                  {WORKFLOW_STAGE_CONTENT.claim.navTitle} resolves deterministic PAY/RESOLVE outcomes.
                </p>
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

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Decentralized and Open"
                title="Transparent execution path with onchain enforcement"
                description="Protocol claims below are constrained to current contract and workflow behavior."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <ul className={styles.list}>
                <li>CRE orchestration routes workflow actions with decentralized consensus and verified reporting.</li>
                <li>Reserve and liability accounting rules are enforced in PolicyVault contract logic.</li>
                <li>Policy lifecycle transitions are visible onchain through PolicyNFT and CREReceiver events.</li>
                <li>Contract and transaction state remains inspectable on BaseScan for independent verification.</li>
                <li>No hidden mutable server-side policy state determines final payout outcomes.</li>
              </ul>
            </div>

            <SectionVisualCard illustration={sectionIllustrations.decentralized} />
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionWithVisual}>
            <div>
              <SectionHeader
                className={styles.sectionHeader}
                eyebrow="Guardrails and Design Decisions"
                title="Risk controls and architecture constraints"
                description="Guardrails reduce invalid state transitions while keeping workflow execution explainable."
                eyebrowClassName={styles.sectionEyebrow}
                titleClassName={styles.sectionTitle}
                descriptionClassName={styles.sectionDescription}
              />

              <h3 className={styles.sectionSubtitle}>Guardrails</h3>
              <div className={styles.overviewCardGrid}>
                {guardrails.map((item) => (
                  <Card key={item} className={styles.overviewStepCard}>
                    <CardBody>
                      <p className={styles.overviewStepDescription} style={{ color: "#ffffff", fontWeight: 500, margin: 0 }}>
                        {item}
                      </p>
                    </CardBody>
                  </Card>
                ))}
              </div>

              <h3 className={styles.sectionSubtitle} style={{ marginTop: "1.25rem" }}>Design decisions</h3>
              <div className={styles.overviewCardGrid}>
                {designDecisions.map((item) => (
                  <Card key={item} className={styles.overviewStepCard}>
                    <CardBody>
                      <p className={styles.overviewStepDescription} style={{ color: "#ffffff", fontWeight: 500, margin: 0 }}>
                        {item}
                      </p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>

            <SectionVisualCard illustration={sectionIllustrations.guardrails} />
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
                  Buy / Mint / Claim Console
                </Link>
              </div>
            </div>

            <div>
              <h2 className={styles.footerTitle}>Protocol</h2>
              <div className={styles.footerLinks}>
                <a href={receiverUrl} target="_blank" rel="noreferrer" className={styles.footerLink}>
                  CREReceiver
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
              <h2 className={styles.footerTitle}>Resources</h2>
              <div className={styles.footerLinks}>
                <a href="https://docs.chain.link/cre" target="_blank" rel="noreferrer" className={styles.footerLink}>
                  CRE Docs
                </a>
                <a href="https://docs.cdp.coinbase.com/x402/docs/welcome" target="_blank" rel="noreferrer" className={styles.footerLink}>
                  x402 Docs
                </a>
                <a href={config.basescan} target="_blank" rel="noreferrer" className={styles.footerLink}>
                  BaseScan
                </a>
              </div>
            </div>
          </div>

          <Divider className={styles.softDivider} />

          <p className={styles.footerMeta}>
            Network: Base Sepolia ({config.chainId}) | Demo status: active prototype | Educational demo; not financial
            advice.
          </p>
        </footer>
      </div>
    </main>
  );
}

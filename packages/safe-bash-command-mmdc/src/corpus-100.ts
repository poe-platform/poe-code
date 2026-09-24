export interface ComplexDiagramCase {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly category: "flowchart" | "sequence" | "state" | "class" | "er";
  readonly source: string;
}

const FLOWCHART_DOMAINS = [
  { name: "Global Edge CDN & Zero-Trust WAF", dir: "TD", groupA: "Anycast Edge", groupB: "Core Mesh", db: "Session KV", hex: "Rate Limiter", sub: "mTLS Handshake", metric: "Δt ≤ 4ms" },
  { name: "Distributed Saga Payment Orchestrator", dir: "LR", groupA: "Checkout Ingress", groupB: "Ledger Settlement", db: "Journal DB", hex: "Idempotency Gate", sub: "Compensate Tx", metric: "p99 ≤ 18ms" },
  { name: "Kubernetes Multi-Cluster Canary Controller", dir: "TD", groupA: "Control Plane", groupB: "Worker Fleet", db: "etcd Raft", hex: "SLO Gate", sub: "Rollout Hook", metric: "Err < 0.01%" },
  { name: "LLVM SSA Optimizer & Register Allocator", dir: "LR", groupA: "Frontend IR", groupB: "Backend Codegen", db: "Symbol Table", hex: "Dominator Tree", sub: "Spill Coalesce", metric: "O(N log N)" },
  { name: "Kafka Exactly-Once Stream Topology", dir: "TD", groupA: "Ingest Partition", groupB: "Stateful Window", db: "RocksDB State", hex: "Watermark Check", sub: "Commit Offset", metric: "λ = 50k/s" },
  { name: "Autonomous Agent Sandbox Execution Loop", dir: "LR", groupA: "Planner Context", groupB: "Virtual Shell VFS", db: "Artifact Store", hex: "Policy Guard", sub: "Spawn Tool", metric: "Budget ≤ 32MB" },
  { name: "Multi-Region Postgres Logical Replication", dir: "BT", groupA: "Primary us-east", groupB: "Replica eu-central", db: "WAL Segment", hex: "LSN Quorum", sub: "Apply Batch", metric: "Lag ≤ 12ms" },
  { name: "OAuth2 PKCE & Federation Token Broker", dir: "RL", groupA: "Identity Provider", groupB: "Resource Gateway", db: "JWK Keyring", hex: "Audience Check", sub: "Mint JWT", metric: "TTL = 300s" },
  { name: "GPU Distributed Tensor All-Reduce Pipeline", dir: "TD", groupA: "Forward Pass", groupB: "Ring AllReduce", db: "Checkpoint S3", hex: "Grad Norm OK?", sub: "NVLink Sync", metric: "FP16 940 TFLOP" },
  { name: "Zero-Downtime Schema Migration Runner", dir: "LR", groupA: "Shadow Dual-Write", groupB: "Backfill Verifier", db: "Target Cluster", hex: "Checksum Match?", sub: "Cutover View", metric: "0 Locked Rows" },
  { name: "GraphQL Federated Subgraph Query Planner", dir: "TD", groupA: "Supergraph Router", groupB: "Domain Subgraphs", db: "Query Plan Cache", hex: "Depth <= 8?", sub: "Fetch Entities", metric: "Cache 96%" },
  { name: "eBPF XDP Packet Filter & DDoS Scrubbing", dir: "LR", groupA: "NIC RX Queue", groupB: "XDP Kernel Hook", db: "BPF LRU Map", hex: "SYN Flood?", sub: "XDP_PASS", metric: "24 Mpps" },
  { name: "Serverless Cold-Start Snapshot Restorer", dir: "TD", groupA: "Firecracker VMM", groupB: "OverlayFS Mount", db: "Page Cache", hex: "Warm Slot?", sub: "Restore UFFD", metric: "Boot ≤ 9ms" },
  { name: "B-Tree Page Split & Write-Ahead Log Flush", dir: "BT", groupA: "Buffer Pool", groupB: "NVMe Flush Queue", db: "Leaf Page 8KB", hex: "Fill > 90%?", sub: "Fsync Group", metric: "IOPS = 180k" },
  { name: "WebRTC SFU Simulcast Bitrate Adapter", dir: "LR", groupA: "RTP Ingress", groupB: "Egress BWE", db: "TWCC Window", hex: "Packet Loss?", sub: "Switch Layer", metric: "Jitter ≤ 6ms" },
  { name: "Supply Chain SBOM & Sigstore Attestation", dir: "RL", groupA: "Build Hermetic", groupB: "Rekor Transparency", db: "OCI Registry", hex: "Cosign Valid?", sub: "Publish Digest", metric: "SLSA L3" },
  { name: "Realtime Fraud Feature Vector Scorer", dir: "TD", groupA: "Event Collector", groupB: "ONNX Inference", db: "Feature Redis", hex: "Risk < 0.72?", sub: "Step-Up 3DS", metric: "Score 3.2ms" },
  { name: "Vector Database HNSW Graph Indexer", dir: "LR", groupA: "Embedding Batch", groupB: "HNSW Layer 0..M", db: "Mmap Segments", hex: "Recall >= 0.98?", sub: "Prune Edges", metric: "dim = 1536" },
  { name: "Distributed Lock Lease & Fencing Token Manager", dir: "TD", groupA: "Client Contender", groupB: "Paxos Lease Group", db: "Epoch Log", hex: "Epoch Monotonic?", sub: "Grant Lease", metric: "Lease 5000ms" },
  { name: "Browser Compositor Tile Rasterization Pipeline", dir: "LR", groupA: "DOM Layout Tree", groupB: "GPU Tile Pool", db: "DisplayList", hex: "Dirty Rect?", sub: "Raster 8x8", metric: "120 FPS" },
  { name: "Quantum Circuit Transpiler & Gate Router", dir: "TD", groupA: "Logical Qubits", groupB: "Heavy-Hex Topology", db: "Calibration DB", hex: "SWAP Depth OK?", sub: "Unitary Decomp", metric: "Fidelity 99.8%" },
  { name: "Cellular 5G Core UPF Session Establishment", dir: "LR", groupA: "gNodeB RAN", groupB: "SMF / UPF Core", db: "UDM Subscriber", hex: "QoS Slice OK?", sub: "GTP-U Tunnel", metric: "URLLC 1ms" },
  { name: "Autonomous Vehicle Sensor Fusion & Planner", dir: "BT", groupA: "LiDAR + Radar", groupB: "MPC Trajectory", db: "HD Voxel Map", hex: "Safety Margin?", sub: "Actuate Steer", metric: "100 Hz Loop" },
  { name: "Content Moderation Multi-Modal Escalation", dir: "RL", groupA: "Media Upload", groupB: "Classifier Ensemble", db: "Audit Ledger", hex: "Confidence > 0.9?", sub: "Human Review", metric: "Queue < 2s" },
  { name: "Time-Series Compaction & Downsampling Tier", dir: "TD", groupA: "MemTable Head", groupB: "Parquet Cold Tier", db: "TSDB Block", hex: "Retention 30d?", sub: "Zstd Compress", metric: "Ratio 14.2x" }
];

const SEQUENCE_DOMAINS = [
  { name: "OAuth 2.1 PKCE + DPoP Token Exchange", p1: "Browser SPA", p2: "Edge Gateway", p3: "Auth Server", p4: "HSM Keyring", m1: "POST /authorize (code_challenge)", m2: "Verify DPoP Proof & Nonce", m3: "Sign Access JWT (ES256)", altOk: "Challenge Verified", altErr: "Invalid Verifier" },
  { name: "Two-Phase Commit (2PC) Cross-Shard Transfer", p1: "Coordinator", p2: "Shard Alpha", p3: "Shard Beta", p4: "Audit Ledger", m1: "PREPARE tx_id=9841", m2: "Acquire Row Locks & WAL", m3: "COMMIT tx_id=9841", altOk: "Both Voted YES", altErr: "Shard Timeout / ABORT" },
  { name: "TLS 1.3 0-RTT Resumption & mTLS Handshake", p1: "Client Workload", p2: "Envoy Proxy", p3: "SPIFFE Agent", p4: "Root CA", m1: "ClientHello + early_data + KeyShare", m2: "Validate X.509 SVID Chain", m3: "Finished + Application Data", altOk: "PSK Ticket Valid", altErr: "Fallback Full 1-RTT" },
  { name: "Stripe Webhook Idempotent Settlement Flow", p1: "Stripe Edge", p2: "Webhook Ingress", p3: "Order Service", p4: "Postgres Ledger", m1: "POST /webhooks (Stripe-Signature)", m2: "INSERT idempotency_key ON CONFLICT", m3: "Append Double-Entry Journal", altOk: "First Delivery", altErr: "Duplicate Event Replay" },
  { name: "Raft Consensus Leader Election & Log Append", p1: "Candidate Node", p2: "Follower A", p3: "Follower B", p4: "State Machine", m1: "RequestVote(term=42, lastLogIdx=910)", m2: "AppendEntries(term=42, entries[911])", m3: "Apply Committed Entry #911", altOk: "Quorum Achieved (2/3)", altErr: "Higher Term Discovered" },
  { name: "WebRTC ICE Trickle & DTLS-SRTP Media Setup", p1: "Peer Caller", p2: "Signaling WS", p3: "TURN Relay", p4: "Peer Callee", m1: "SDP Offer + ICE Candidates", m2: "STUN Binding Request (XOR-Mapped)", m3: "DTLS Handshake + SRTP Keyring", altOk: "Direct P2P Nominated", altErr: "Symmetric NAT -> TURN Relay" },
  { name: "gRPC Bidirectional Streaming & Flow Control", p1: "SDK Client", p2: "HTTP/2 Mux", p3: "Stream Worker", p4: "Vector Index", m1: "HEADERS :path=/v1.Search/Stream", m2: "DATA Frame (WindowUpdate=64KB)", m3: "Top-K Cosine Neighbors", altOk: "Credits Available", altErr: "Backpressure Pause" },
  { name: "Kubernetes Pod Scheduling & CNI Attachment", p1: "API Server", p2: "Scheduler", p3: "Kubelet Node", p4: "Cilium eBPF", m1: "Watch Unscheduled PodSpec", m2: "Bind Pod -> node-west-04", m3: "Setup veth & BPF Endpoint Map", altOk: "Image Pulled & Ready", altErr: "ImagePullBackOff" },
  { name: "Kafka Consumer Group Cooperative Rebalance", p1: "Consumer C1", p2: "GroupCoord", p3: "Broker Leader", p4: "Offset Store", m1: "JoinGroup(protocol=cooperative-sticky)", m2: "SyncGroup(Assigned Partitions 0..3)", m3: "OffsetCommit(partition=2, offset=8812)", altOk: "Generation Stable", altErr: "Fenced Instance ID" },
  { name: "Distributed Tracing W3C Traceparent Propagation", p1: "Ingress CDN", p2: "BFF GraphQL", p3: "Catalog Svc", p4: "OTLP Collector", m1: "GET /product (traceparent: 00-4bf9...)", m2: "ResolveSubgraph(span_id=a91c)", m3: "ExportBatchSpans(Protobuf)", altOk: "Sampled (flags=01)", altErr: "Tail-Drop Headroom" },
  { name: "Git Packfile Negotiation & Smart HTTP Push", p1: "Git CLI", p2: "SSH/HTTPS Edge", p3: "Receive-Pack", p4: "Object Quarantine", m1: "POST /git-receive-pack (old..new OID)", m2: "Unpack Delta Objects & Verify SHA-256", m3: "Run pre-receive Hook & Update Ref", altOk: "Fast-Forward Verified", altErr: "Non-FF Rejected" },
  { name: "Serverless Durable Workflow Replay Engine", p1: "Workflow API", p2: "History Queue", p3: "Replay Worker", p4: "Activity Runner", m1: "SignalWorkflow(WorkflowStarted)", m2: "Load Event History [1..24]", m3: "ScheduleActivityTask(ChargeCard)", altOk: "Deterministic Match", altErr: "Non-Deterministic NondetError" },
  { name: "DNSSEC Chain of Trust & DoH Resolution", p1: "Stub Resolver", p2: "DoH Edge", p3: "Root / TLD NS", p4: "Auth Zone NS", m1: "GET /dns-query (QTYPE=AAAA, DO=1)", m2: "Fetch DS + DNSKEY Records", m3: "Verify RRSIG Ed25519 Signature", altOk: "AD Bit = 1 Verified", altErr: "SERVFAIL Bogus Sig" },
  { name: "Database Read-Through Cache Lease Stampede Guard", p1: "App Worker", p2: "Redis Cluster", p3: "Singleflight", p4: "Primary Postgres", m1: "GET user:profile:7712", m2: "SETNX lease:7712 (TTL=2000ms)", m3: "SELECT * FROM profiles WHERE id=7712", altOk: "Lease Acquired", altErr: "Wait 15ms & Poll Cache" },
  { name: "Container OCI Image Layer CAS Pull & Unpack", p1: "Containerd", p2: "Registry Auth", p3: "CDN Blob Store", p4: "OverlayFS", m1: "GET /v2/app/manifests/sha256:9f8a...", m2: "Range GET Blob Layer (zstd:chunked)", m3: "Verify Digest & Apply Whiteouts", altOk: "Digest Verified", altErr: "Hash Mismatch Abort" },
  { name: "Autonomous Safe-Bash mmdc Render & Verify Pipeline", p1: "VirtualShell", p2: "MmdcCommand", p3: "SugiyamaLayout", p4: "SubpixelPng", m1: "exec(mmdc -i arch.mmd -o out.png)", m2: "Parse AST & Assign Barycenter Ranks", m3: "Rasterize 8x8 SFNS + Verify Geometry", altOk: "All 6 Invariants OK", altErr: "E_LIMIT_EXCEEDED" },
  { name: "Passkey WebAuthn FIDO2 Resident Key Login", p1: "User Authenticator", p2: "Browser WebAuthn", p3: "Relying Party", p4: "FIDO Metadata", m1: "navigator.credentials.get(challenge)", m2: "Sign clientDataJSON + authenticatorData", m3: "Verify COSE PublicKey & SignCount", altOk: "UV=1 & Counter > Prev", altErr: "Cloned Authenticator Alert" },
  { name: "Zero-Knowledge Proof Groth16 Verifier Contract", p1: "Prover Node", p2: "Relayer Sequencer", p3: "L2 Rollup VM", p4: "L1 Verifier", m1: "Compute Witness & Pairing Proof (pi_A, pi_B, pi_C)", m2: "Submit Batch StateRoot + Proof", m3: "bn256PairingCheck(IC, Proof) == 1", altOk: "Pairing Validated", altErr: "Revert InvalidBatch" },
  { name: "ML Feature Store Point-in-Time Correct Join", p1: "Training Job", p2: "Feature Registry", p3: "Offline Parquet", p4: "Online Redis", m1: "GetHistoricalFeatures(entity_df, as_of)", m2: "ASOF Join Events <= label_timestamp", m3: "Materialize Arrow RecordBatch", altOk: "Zero Data Leakage", altErr: "Schema Drift Detected" },
  { name: "Multi-Region Active-Active CRDT State Sync", p1: "Replica US-West", p2: "Gossip Mesh", p3: "Replica EU-West", p4: "LWW-Element-Set", m1: "Broadcast Delta-State (HybridLogicalClock)", m2: "Compare Vector Clocks & Merge Lattice", m3: "Persist Merged Digest & Ack", altOk: "Causal Order Clean", altErr: "Fetch Missing Anti-Entropy" }
];

const STATE_DOMAINS = [
  { name: "Distributed Worker Sandbox Lifecycle", dir: "TD", comp: "Processing", s1: "Fetching", s2: "Executing", s3: "Verifying", outer1: "Idle", outer2: "Completed", err: "Failed", desc: "Fetch VFS input & budget" },
  { name: "TCP Congestion Control (CUBIC / BBR)", dir: "TD", comp: "Established", s1: "SlowStart", s2: "CongestionAvoid", s3: "FastRecovery", outer1: "SynSent", outer2: "TimeWait", err: "Retransmit", desc: "cwnd < ssthresh" },
  { name: "Circuit Breaker Resilience Automaton", dir: "LR", comp: "ProtectedCall", s1: "ClosedNormal", s2: "RollingWindow", s3: "HalfOpenProbe", outer1: "Initializing", outer2: "Recovered", err: "TrippedOpen", desc: "Error rate < 5%" },
  { name: "Payment Intent 3D-Secure Lifecycle", dir: "TD", comp: "Authorizing", s1: "RiskCheck", s2: "Challenge3DS", s3: "HoldFunds", outer1: "Created", outer2: "Captured", err: "Declined", desc: "Verify issuer ACS" },
  { name: "Raft Node Term & Role Automaton", dir: "LR", comp: "ClusterMember", s1: "Follower", s2: "Candidate", s3: "LeaderActive", outer1: "BootingWAL", outer2: "SnapshotSync", err: "SteppedDown", desc: "Heartbeat timer armed" },
  { name: "NVMe SSD Garbage Collection & Wear Leveling", dir: "TD", comp: "FlashController", s1: "ScanBlocks", s2: "CopyValidPages", s3: "EraseBlock", outer1: "IdleReady", outer2: "FreePoolReady", err: "BadBlockRetired", desc: "Read valid LBA mapping" },
  { name: "Autonomous Superintendent Build-Inspect-Review", dir: "TD", comp: "IterationLoop", s1: "BuilderRun", s2: "InspectorCheck", s3: "SuperintendentReview", outer1: "PlanLoaded", outer2: "GoalApproved", err: "NeedsRework", desc: "Execute TDD changes" },
  { name: "WebSocket Auto-Reconnecting Multiplexer", dir: "LR", comp: "ConnectedSession", s1: "Authenticated", s2: "Subscribed", s3: "HeartbeatPing", outer1: "Connecting", outer2: "GracefulClosed", err: "JitterBackoff", desc: "TLS 1.3 WSS active" },
  { name: "Compiler Lexer & Pratt Expression Parser", dir: "TD", comp: "TokenStream", s1: "ScanIdent", s2: "ParseInfix", s3: "FoldConstants", outer1: "SourceOpen", outer2: "ASTEmitted", err: "SyntaxRecovery", desc: "Binding power >= minBP" },
  { name: "Kubernetes Pod Phase & Container Probe Machine", dir: "TD", comp: "RunningPhase", s1: "InitContainers", s2: "StartupProbe", s3: "ReadinessServing", outer1: "PendingSched", outer2: "SucceededZero", err: "CrashLoop", desc: "Exec probe exit 0" },
  { name: "Database MVCC Transaction Isolation State", dir: "LR", comp: "ActiveTx", s1: "SnapshotRead", s2: "WriteIntent", s3: "SerializeCheck", outer1: "BeginTx", outer2: "CommittedLSN", err: "SerializationRetry", desc: "xmin <= snapshot_xmax" },
  { name: "OAuth Device Authorization Grant Polling", dir: "TD", comp: "UserVerification", s1: "CodeDisplayed", s2: "BrowserPrompt", s3: "ConsentGranted", outer1: "DeviceInit", outer2: "TokenIssued", err: "SlowDownPoll", desc: "Awaiting user code" },
  { name: "OTA Firmware Dual-Bank A/B Update", dir: "LR", comp: "BankBFlash", s1: "DownloadChunk", s2: "VerifyEd25519", s3: "TrialBoot", outer1: "RunningBankA", outer2: "BankBCommitted", err: "RollbackBankA", desc: "Stream delta blocks" },
  { name: "Live Video HLS Transcoder Segmenter", dir: "TD", comp: "GOPPipeline", s1: "DecodeIDR", s2: "ScaleFilter", s3: "EncodeAV1", outer1: "RTMPIngest", outer2: "ManifestUpdated", err: "FrameDrop", desc: "2.0s IDR keyframe" },
  { name: "Order Fulfillment Warehouse Robotics", dir: "LR", comp: "PickAndPack", s1: "PathfindAMR", s2: "GripperPick", s3: "WeighVerify", outer1: "OrderAllocated", outer2: "LabelPrinted", err: "ObstacleReplan", desc: "A* aisle routing" },
  { name: "Smart Contract Timelock Governance Proposal", dir: "TD", comp: "VotingWindow", s1: "QuorumAccum", s2: "SucceededVote", s3: "TimelockEta", outer1: "DraftSubmitted", outer2: "ExecutedOnChain", err: "VetoedCanceled", desc: "Block delta >= 50400" },
  { name: "Garbage Collector Tri-Color Concurrent Mark", dir: "LR", comp: "MarkingCycle", s1: "ScanRoots", s2: "DrainGreyStack", s3: "STWReMark", outer1: "HeapIdle", outer2: "SweepReclaim", err: "WriteBarrierHit", desc: "Shade reachable black" },
  { name: "Airplane Autopilot ILS Cat-III Autoland", dir: "TD", comp: "ApproachCoupled", s1: "LocalizerLock", s2: "GlideslopeTrack", s3: "FlareTouchdown", outer1: "CruiseNav", outer2: "RolloutBraking", err: "GoAroundTOGA", desc: "Dual radio altimeter" },
  { name: "TLS Certificate ACME Let-s-Encrypt Renewal", dir: "LR", comp: "ChallengeFlow", s1: "OrderCreated", s2: "DNS01TxtRecord", s3: "FinalizeCSR", outer1: "CertExpiring", outer2: "ReloadedNginx", err: "ValidationRetry", desc: "Propagate _acme-challenge" },
  { name: "Distributed Cache Cohort Invalidation", dir: "TD", comp: "InvalidationWave", s1: "MarkStale", s2: "PurgeEdgePoPs", s3: "RewarmOrigin", outer1: "MutationEvent", outer2: "ConsistentView", err: "OriginOverload", desc: "Broadcast purge key" }
];

const CLASS_DOMAINS = [
  { name: "Safe-Bash Virtual Shell & Command Architecture", ns1: "Runtime", ns2: "Commands", c1: "VirtualShell", c2: "ShellPlugin", c3: "MmdcCommand", c4: "MermaidScene", st1: "service", st2: "interface" },
  { name: "DDD E-Commerce Order & Settlement Domain", ns1: "Ordering", ns2: "Billing", c1: "OrderAggregate", c2: "DomainEvent", c3: "LineItemEntity", c4: "PaymentService", st1: "aggregate", st2: "interface" },
  { name: "Compiler AST, TypeChecker & IR Emitter", ns1: "Frontend", ns2: "Codegen", c1: "TypeChecker", c2: "AstNode", c3: "BinaryExpr", c4: "IrBuilder", st1: "service", st2: "abstract" },
  { name: "Reactive Stream Backpressure Operator Graph", ns1: "Streams", ns2: "Schedulers", c1: "Observable", c2: "Subscriber", c3: "MapFilterOp", c4: "EventLoopPool", st1: "abstract", st2: "interface" },
  { name: "Multi-Tenant RBAC & ABAC Policy Engine", ns1: "Identity", ns2: "Authorization", c1: "PolicyEvaluator", c2: "Principal", c3: "RoleBinding", c4: "PermissionGuard", st1: "service", st2: "interface" },
  { name: "Storage Engine LSM-Tree & SSTable Compactor", ns1: "MemTable", ns2: "DiskTier", c1: "LsmEngine", c2: "Iterator", c3: "SkipListMem", c4: "SsTableReader", st1: "service", st2: "interface" },
  { name: "Vector Search HNSW Index & Quantizer", ns1: "Indexing", ns2: "Quantization", c1: "HnswIndex", c2: "DistanceMetric", c3: "GraphLayer", c4: "ProductQuantizer", st1: "service", st2: "interface" },
  { name: "Kubernetes Custom Resource Operator SDK", ns1: "Controller", ns2: "Resources", c1: "Reconciler", c2: "CustomResource", c3: "ClusterRollout", c4: "KubeClient", st1: "service", st2: "interface" },
  { name: "GraphQL Schema Stitcher & DataLoader", ns1: "Execution", ns2: "Batching", c1: "QueryExecutor", c2: "FieldResolver", c3: "EntityStitcher", c4: "BatchDataLoader", st1: "service", st2: "interface" },
  { name: "WebGPU RenderGraph & Shader Pipeline", ns1: "SceneGraph", ns2: "GpuBackend", c1: "RenderPass", c2: "ShaderModule", c3: "PbrMaterial", c4: "CommandEncoder", st1: "service", st2: "interface" },
  { name: "Autonomous Agent Harness & Tool Registry", ns1: "Orchestrator", ns2: "Tools", c1: "AgentRunner", c2: "ToolContract", c3: "SafeBashTool", c4: "TokenBudget", st1: "service", st2: "interface" },
  { name: "Distributed Tracing OpenTelemetry SDK", ns1: "Tracing", ns2: "Exporters", c1: "TracerProvider", c2: "SpanProcessor", c3: "BatchExporter", c4: "OtlpGrpcClient", st1: "service", st2: "interface" },
  { name: "Financial FIX Protocol Order Matching Engine", ns1: "Matching", ns2: "OrderBook", c1: "MatchingEngine", c2: "OrderCommand", c3: "LimitOrder", c4: "PriceLevelTree", st1: "service", st2: "interface" },
  { name: "Cryptography KMS Envelope Encryption", ns1: "KeyMgmt", ns2: "Ciphers", c1: "EnvelopeService", c2: "KeyProvider", c3: "HsmKeyRing", c4: "AesGcmCipher", st1: "service", st2: "interface" },
  { name: "Workflow DAG Scheduler & Task Retry Pool", ns1: "Scheduler", ns2: "Workers", c1: "DagCoordinator", c2: "TaskExecutable", c3: "ShellTaskNode", c4: "WorkerLeasePool", st1: "service", st2: "interface" },
  { name: "CRDT Collaborative Document Editor", ns1: "Document", ns2: "SyncProtocol", c1: "YDocReplica", c2: "CrdtItem", c3: "RichTextSpan", c4: "GossipPeer", st1: "service", st2: "interface" },
  { name: "Feature Flag Rollout & Experimentation SDK", ns1: "Evaluation", ns2: "Telemetry", c1: "FlagClient", c2: "TargetingRule", c3: "MurmurBucketer", c4: "ExposureLogger", st1: "service", st2: "interface" },
  { name: "Container Runtime OCI Spec & Cgroup Manager", ns1: "Container", ns2: "Isolation", c1: "OciRuntime", c2: "NamespaceSpec", c3: "RootfsMount", c4: "CgroupV2Limits", st1: "service", st2: "interface" },
  { name: "Time-Series PromQL Parser & Vector Evaluator", ns1: "QueryLang", ns2: "Storage", c1: "PromQlEngine", c2: "VectorSelector", c3: "RateAggregator", c4: "ChunkSeries", st1: "service", st2: "interface" },
  { name: "Audio DSP Synthesizer Modular Node Graph", ns1: "GraphEngine", ns2: "Nodes", c1: "AudioContext", c2: "DspProcessor", c3: "BiquadFilter", c4: "WavetableOsc", st1: "service", st2: "interface" }
];

const ER_DOMAINS = [
  { name: "Multi-Tenant SaaS Subscription & Usage Billing", e1: "ORGANIZATION", e2: "SUBSCRIPTION", e3: "INVOICE", e4: "USAGE_METER", e5: "PAYMENT_METHOD", e6: "AUDIT_LOG" },
  { name: "Core Banking Double-Entry Ledger & Treasury", e1: "ACCOUNT", e2: "JOURNAL_ENTRY", e3: "POSTING_LINE", e4: "SETTLEMENT_BATCH", e5: "FX_RATE", e6: "COMPLIANCE_HOLD" },
  { name: "Hospital Electronic Health Record (FHIR EHR)", e1: "PATIENT", e2: "ENCOUNTER", e3: "CLINICAL_ORDER", e4: "LAB_RESULT", e5: "PRACTITIONER", e6: "MEDICATION_DISPENSE" },
  { name: "Global Supply Chain & Warehouse Inventory", e1: "WAREHOUSE", e2: "SKU_CATALOG", e3: "INVENTORY_LOT", e4: "SHIPMENT_MANIFEST", e5: "PURCHASE_ORDER", e6: "CARRIER_ROUTE" },
  { name: "CI/CD Artifact Registry & Vulnerability Attestation", e1: "REPOSITORY", e2: "PIPELINE_RUN", e3: "OCI_IMAGE", e4: "SBOM_PACKAGE", e5: "CVE_ADVISORY", e6: "COSIGN_ATTESTATION" },
  { name: "Cloud IAM Identity, Roles & Policy Boundaries", e1: "TENANT_REALM", e2: "IAM_PRINCIPAL", e3: "ROLE_ASSUMPTION", e4: "POLICY_DOCUMENT", e5: "SESSION_TOKEN", e6: "ACCESS_KEY" },
  { name: "E-Commerce Marketplace & Split Escrow Payouts", e1: "MERCHANT_STORE", e2: "BUYER_ORDER", e3: "ORDER_ITEM", e4: "ESCROW_RELEASE", e5: "REFUND_CLAIM", e6: "SHIPPING_LABEL" },
  { name: "Streaming Media Content & DRM License Catalog", e1: "MEDIA_TITLE", e2: "VIDEO_ASSET", e3: "ABR_RENDITION", e4: "DRM_KEY_POLICY", e5: "PLAYBACK_SESSION", e6: "CDN_EDGE_POP" },
  { name: "Ride-Sharing Dispatch & Surge Pricing Telemetry", e1: "RIDER_ACCOUNT", e2: "DRIVER_VEHICLE", e3: "TRIP_DISPATCH", e4: "HEX_SURGE_ZONE", e5: "WAYPOINT_TRACE", e6: "DRIVER_PAYOUT" },
  { name: "Machine Learning Model Registry & Feature Store", e1: "EXPERIMENT_RUN", e2: "MODEL_VERSION", e3: "FEATURE_VIEW", e4: "TRAINING_DATASET", e5: "SERVING_ENDPOINT", e6: "DRIFT_ALERT" },
  { name: "Airline Reservation PNR & Ticket Coupon System", e1: "PASSENGER_PNR", e2: "FLIGHT_SEGMENT", e3: "ETICKET_COUPON", e4: "AIRCRAFT_TAIL", e5: "SEAT_INVENTORY", e6: "BAGGAGE_TAG" },
  { name: "Smart Grid IoT Metering & Demand Response", e1: "SUBSTATION", e2: "SMART_METER", e3: "INTERVAL_READING", e4: "TARIFF_SCHEDULE", e5: "OUTAGE_TICKET", e6: "BATTERY_DER" },
  { name: "Observability Logs, Metrics & Distributed Traces", e1: "SERVICE_NAMESPACE", e2: "TRACE_ROOT", e3: "SPAN_EVENT", e4: "METRIC_SERIES", e5: "ALERT_INCIDENT", e6: "ONCALL_ROTATION" },
  { name: "Real-Estate Property Title & Mortgage Servicing", e1: "PROPERTY_PARCEL", e2: "MORTGAGE_LOAN", e3: "ESCROW_ACCOUNT", e4: "PAYMENT_SCHEDULE", e5: "APPRAISAL_REPORT", e6: "TITLE_DEED" },
  { name: "Autonomous Agent Goal, Pipeline & Evaluation", e1: "WORKSPACE_REPO", e2: "AGENT_GOAL", e3: "PIPELINE_STAGE", e4: "TOOL_INVOCATION", e5: "VERIFICATION_GATE", e6: "COMMIT_ARTIFACT" }
];

export const COMPLEX_DIAGRAMS_100: readonly ComplexDiagramCase[] = [
  ...FLOWCHART_DOMAINS.map((d, i): ComplexDiagramCase => {
    const idx = i + 1;
    const id = `diagram-${String(idx).padStart(3, "0")}-flowchart`;
    const variant = i % 3;
    const source =
      variant === 0
        ? `flowchart ${d.dir}
  subgraph Ingress ["${d.groupA}"]
    Entry(["Ingress • ${d.metric}"]) -- TLS 1.3 --> Guard{{"${d.hex}"}}
    Guard -- Passed --> Router["Edge Router #${idx}"]
  end
  Router -- gRPC --> Decision
  subgraph Core ["${d.groupB}"]
    Decision{"Policy Valid?"} -- Yes --> Worker[["${d.sub}"]]
    Worker --> PrimaryDB[("${d.db}")]
    Decision -- Bypass --> Audit("Audit & Telemetry")
    PrimaryDB -. Async CDC .-> Audit
  end
  Audit -- Retry Loop --> Entry`
        : variant === 1
          ? `flowchart ${d.dir}
  subgraph EdgeTier ["${d.groupA}"]
    Client(["Client • ${d.metric}"]) --> HexGate{{"${d.hex}"}}
    HexGate --> AuthCheck{"Auth OK?"}
  end
  AuthCheck -- Token Valid --> ExecSub
  AuthCheck -. Rejected .-> DLQ("Dead-Letter Queue")
  subgraph DataTier ["${d.groupB}"]
    ExecSub[["${d.sub}"]] --> CacheDB[("${d.db}")]
    CacheDB ==> Sink(["Committed #${idx}"])
  end
  DLQ --> Sink`
          : `flowchart ${d.dir}
  Start(["Source • ${d.metric}"]) --> StageA[["${d.sub}"]]
  subgraph Pipeline ["${d.groupA} -> ${d.groupB}"]
    StageA --> Gate{{"${d.hex}"}}
    Gate -- FastPath --> Store[("${d.db}")]
    Gate -- SlowPath --> Verify("Deep Verification")
    Verify --> Store
  end
  Store --> Emit(["Published #${idx}"])`;
    return {
      id,
      index: idx,
      title: d.name,
      category: "flowchart",
      source
    };
  }),
  ...SEQUENCE_DOMAINS.map((d, i): ComplexDiagramCase => {
    const idx = 26 + i;
    const id = `diagram-${String(idx).padStart(3, "0")}-sequence`;
    const variant = i % 2;
    const source =
      variant === 0
        ? `sequenceDiagram
  participant P1 as ${d.p1}
  participant P2 as ${d.p2}
  participant P3 as ${d.p3}
  participant P4 as ${d.p4}
  Note over P1,P2: ${d.name}
  P1->>P2: ${d.m1}
  activate P2
  P2->>P2: ${d.m2}
  alt ${d.altOk}
    P2->>P3: Forward Verified Context
    activate P3
    P3->>P4: ${d.m3}
    P4-->>P3: 200 OK (Receipt #${idx})
    P3-->>P2: Commit Confirmed
    deactivate P3
    P2-->>P1: 201 Succeeded
  else ${d.altErr}
    P2--xP1: 429 / 403 Rejected
  end
  deactivate P2`
        : `sequenceDiagram
  participant P1 as ${d.p1}
  participant P2 as ${d.p2}
  participant P3 as ${d.p3}
  participant P4 as ${d.p4}
  P1->>P2: ${d.m1}
  activate P2
  loop Retry Budget <= 3
    P2->>P3: ${d.m2}
    activate P3
    P3->>P4: ${d.m3}
    P4-->>P3: Ack #${idx}
    deactivate P3
  end
  opt ${d.altOk}
    P2-->>P1: Stream Complete
  end
  deactivate P2`;
    return {
      id,
      index: idx,
      title: d.name,
      category: "sequence",
      source
    };
  }),
  ...STATE_DOMAINS.map((d, i): ComplexDiagramCase => {
    const idx = 46 + i;
    const id = `diagram-${String(idx).padStart(3, "0")}-state`;
    return {
      id,
      index: idx,
      title: d.name,
      category: "state",
      source: `stateDiagram-v2
  direction ${d.dir}
  [*] --> ${d.outer1}
  ${d.outer1} --> ${d.comp} : trigger(${idx})
  state ${d.comp} {
    [*] --> ${d.s1}
    ${d.s1} : ${d.desc}
    ${d.s1} --> ${d.s2} : validated
    ${d.s2} --> ${d.s3} : step_complete
  }
  ${d.comp} --> ${d.outer2} : verified_ok
  ${d.comp} --> ${d.err} : fault_detected
  ${d.err} --> ${d.outer1} : backoff_retry
  ${d.outer2} --> [*]
  note left of ${d.outer1} : Invariant Guard #${idx}`
    };
  }),
  ...CLASS_DOMAINS.map((d, i): ComplexDiagramCase => {
    const idx = 66 + i;
    const id = `diagram-${String(idx).padStart(3, "0")}-class`;
    return {
      id,
      index: idx,
      title: d.name,
      category: "class",
      source: `classDiagram
  namespace ${d.ns1} {
    class ${d.c1} {
      <<${d.st1}>>
      +id: string
      -version: number
      +execute(ctx: Context) Result
      +validate() boolean
    }
    class ${d.c2} {
      <<${d.st2}>>
      +handle(payload: Uint8Array) Promise
    }
  }
  namespace ${d.ns2} {
    class ${d.c3} {
      -timeoutMs: number
      +runStep(input: Record) Output
    }
    class ${d.c4} {
      +metrics: Telemetry
      +flush() void
    }
  }
  ${d.c2} <|.. ${d.c3} : implements
  ${d.c1} "1" *-- "1..*" ${d.c2} : orchestrates
  ${d.c3} "1" --> "1" ${d.c4} : dispatches`
    };
  }),
  ...ER_DOMAINS.map((d, i): ComplexDiagramCase => {
    const idx = 86 + i;
    const id = `diagram-${String(idx).padStart(3, "0")}-er`;
    return {
      id,
      index: idx,
      title: d.name,
      category: "er",
      source: `erDiagram
  ${d.e1} ||--o{ ${d.e2} : owns
  ${d.e2} ||--|{ ${d.e3} : contains
  ${d.e2} |o--o{ ${d.e4} : records
  ${d.e3} }|--|| ${d.e5} : references
  ${d.e1} ||--o{ ${d.e6} : audits
  ${d.e1} {
    uuid id PK
    string tenant_slug UK
    timestamp created_at
  }
  ${d.e2} {
    uuid id PK
    uuid parent_id FK
    string status
  }
  ${d.e3} {
    uuid id PK
    uuid group_id FK
    decimal amount
  }
  ${d.e4} {
    uuid id PK
    string metric_key UK
    int64 sample_val
  }
  ${d.e5} {
    uuid id PK
    string code UK
  }
  ${d.e6} {
    uuid id PK
    uuid actor_id FK
    string digest
  }`
    };
  })
];

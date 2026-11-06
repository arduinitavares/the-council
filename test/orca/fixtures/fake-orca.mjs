import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const version = args[0] === "--fixture-version" ? args.splice(0, 2)[1] : "fixture-1";
if (args[0] === "--version") process.stdout.write(version);
else if (args[0] === "skills")
  console.log(
    JSON.stringify({
      name: args[2],
      version: "fixture-1",
      markdown: "Fixture command guide; synthetic only.",
    }),
  );
else if (
  args[0] === "orchestration" &&
  args[1] === "worker-stop" &&
  args[2] === "--dispatch" &&
  args[3] &&
  args[4] === "--json"
)
  console.log(
    JSON.stringify({
      dispatchId: args[3],
      nativeActions: ["stop"],
      children: [],
    }),
  );
else if (args[0] === "echo-argv")
  console.log(
    JSON.stringify({
      argv: args.slice(1),
      cwd: process.cwd(),
      envKeys: Object.keys(process.env).sort(),
      nativeActions: [],
      children: [],
    }),
  );
else if (args[0] === "oversize")
  process.stdout.write("x".repeat(1024 * 1024 * 2));
else if (args[0] === "fail") process.exit(17);
else if (args[0] === "child") {
  const p = spawn(process.execPath, ["-e", "setTimeout(()=>{},250)"], {
    stdio: "inherit",
  });
  console.log(JSON.stringify({ child: p.pid }));
  process.exit(0);
} else {
  console.error("unsupported fixture command");
  process.exit(2);
}

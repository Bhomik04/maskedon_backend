import { Client } from "pg";

const regions = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "ca-central-1", "eu-central-1", "eu-west-1", "eu-west-2",
  "eu-west-3", "eu-north-1", "ap-south-1", "ap-southeast-1",
  "ap-southeast-2", "ap-northeast-1", "ap-northeast-2", "sa-east-1"
];

async function testHost(host: string): Promise<boolean> {
  const connStr = `postgresql://postgres.aulqrcteudddqcyrukgi:Masked@man12@${host}:5432/postgres`;
  const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function testAll() {
  console.log("Starting exhaustive host region scan...");
  
  const promises: { host: string; promise: Promise<boolean> }[] = [];
  
  for (const region of regions) {
    for (const prefix of ["aws-0", "aws-1", "aws-2", "aws-3"]) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      promises.push({
        host,
        promise: testHost(host)
      });
    }
  }

  console.log(`Scanning ${promises.length} potential pooler hosts concurrently...`);
  
  const results = await Promise.all(
    promises.map(async (p) => {
      const ok = await p.promise;
      return { host: p.host, ok };
    })
  );

  const success = results.find(r => r.ok);
  if (success) {
    console.log(`\n🎉 SUCCESS! Connected to: ${success.host}`);
  } else {
    console.log("\nAll host region tests failed.");
  }
}

testAll();

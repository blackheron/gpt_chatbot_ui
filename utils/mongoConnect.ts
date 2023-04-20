import { MongoClient, Db } from "mongodb";
let cachedDb: Db;

export async function connectToDatabase(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI not found in environment variables");
  }

  const client = await MongoClient.connect(uri);
 
  const db = client.db("Financials");
  cachedDb = db;

  return db;
}

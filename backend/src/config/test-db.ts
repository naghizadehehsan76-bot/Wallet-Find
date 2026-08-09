import prisma from "./prisma.js";

async function main() {
  try {
    await prisma.$connect();

    const result = await prisma.user.count();

    console.log("Database connected successfully.");
    console.log(`Users in database: ${result}`);
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
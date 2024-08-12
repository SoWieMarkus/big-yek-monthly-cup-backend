import type { LeaderboardEntry, QualifierResult } from "@prisma/client";
import { Log } from ".";
import { database } from "../database";

type Columns = [number, number, string, string, string];

type DataArray = Columns[];

const POSITION = 0;
const POINTS = 1;
const NAME = 2;
const LOGIN = 3;
const ZONE = 4;

const POINT_LIMIT_SERVER_ONE = 6969;
const POINT_LIMIT_SERVER_TWO = 4500;

export const updateResults = async (
	qualifierId: number,
	server: number,
	content: DataArray,
) => {
	for (const row of content) {
		await database.player.upsert({
			where: {
				id: row[LOGIN],
			},
			create: {
				name: row[NAME],
				id: row[LOGIN],
				zone: row[ZONE],
			},
			update: {
				name: row[NAME],
				zone: row[ZONE],
			},
		});
	}

	await database.qualifierResult.deleteMany({
		where: {
			qualifierId,
			server
		},
	});
	await database.qualifierResult.createMany({
		data: content.map((row) => {
			return {
				playerId: row[LOGIN],
				points: row[POINTS],
				position: row[POSITION],
				qualifierId,
				server
			};
		}),
	});
};

export const getPointsByResult = (result: QualifierResult) => {
	if (result.server === 1) {
		if (result.position >= 1 && result.position <= 3) return 50000;
		if (result.position === 4) return 15000;
		if (result.position === 5) return 10000;
		if (result.points >= POINT_LIMIT_SERVER_ONE) return 7500;
		return result.points;
	}
	if (result.server === 2) {
		if (result.position === 1) return 6500;
		if (result.position === 2) return 6000;
		if (result.position === 3) return 5500;
		if (result.points >= POINT_LIMIT_SERVER_TWO) return 5000;
		return result.points;
	}
	return 0;
}

export const isQualified = (result: QualifierResult) => {
	return result.position >= 1 && result.position <= 3 && result.server === 1;
}

export const updateLeaderboard = async (cupId: number) => {
	const cup = await database.cup.findUnique({
		where: {
			id: cupId,
		},
		include: {
			leaderboard: true,
		}
	});
	if (cup === null)
		throw new Error(`No Cup with id ${cupId}.`);
	if (cup.leaderboard === null)
		throw new Error("Cup has no leaderboard! YEK?");

	const allResultsOfCup = await database.qualifierResult.findMany({
		where: {
			qualifier: {
				cupId: cup.id,
			},
		},
	});

	await database.leaderboardEntry.deleteMany({
		where: {
			leaderboardId: cup.leaderboard.id,
		},
	});

	const map: Record<string, LeaderboardEntry> = {};

	for (const result of allResultsOfCup) {
		const id = result.playerId;
		const entry = map[id] ?? {
			qualified: false,
			points: 0,
			playerId: id,
			leaderboardId: cup.leaderboard.id,
			position: 0
		};
		const points = getPointsByResult(result);
		const qualified = isQualified(result);
		entry.points += points;

		if (qualified) {
			entry.qualified = qualified;
		}

		map[id] = entry;
	}

	const leaderboard = Object.values(map);
	leaderboard.sort((a, b) => b.points - a.points);

	let currentRank = 1;
	let previousAmount: number | undefined = undefined;
	let rankCount = 0;

	for (const entry of leaderboard) {
		if (entry.qualified) {
			rankCount++;
		} else if (previousAmount !== entry.points) {
			currentRank += rankCount;
			rankCount = 1;
		} else {
			rankCount++;
		}

		entry.position = currentRank;
		previousAmount = entry.points;
	}

	await database.leaderboardEntry.createMany({
		data: Object.values(map),
	});

	Log.complete(`Updated leaderboard of cup ${cup.id}`);
};

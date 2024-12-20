import type { RequestHandler } from "express";
import createHttpError, { isHttpError } from "http-errors";
import Joi, { version } from "joi";
import { database } from "../database";
import { getCupDisplayName } from "../util/cup";
import { updateResults, updateLeaderboard } from "../util/leaderboard";
import { validateInteger } from "../util/validate-integer";

const createCupBodySchema = Joi.object({
	year: Joi.number().integer().min(2024).required(),
	month: Joi.number().integer().min(0).max(11).required(),
});

export const createCup: RequestHandler = async (request, response, next) => {
	try {
		const parsedBody = createCupBodySchema.validate(request.body);

		if (parsedBody.error) {
			throw createHttpError(400, parsedBody.error);
		}

		const { year, month } = parsedBody.value;

		const cups = await database.cup.findMany();
		const current = cups.length === 0;
		const name = getCupDisplayName(year, month);

		const cup = await database.cup.create({
			data: {
				year,
				month,
				current,
				name,
				public: false,
			},
		});

		const cupId = cup.id;

		await database.qualifier.createMany({
			data: [
				{ version: 1, cupId },
				{ version: 2, cupId },
				{ version: 3, cupId },
			],
		});

		await database.final.create({ data: { cupId } });
		await database.leaderboard.create({ data: { cupId } });

		response.json(cup).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, "Error while creating cup."));
	}
};

const cupVisibilityBodySchema = Joi.object({
	visible: Joi.boolean().required(),
});

export const setCupVisibility: RequestHandler = async (
	request,
	response,
	next,
) => {
	const { cupId } = request.params;
	try {
		const parsedBody = cupVisibilityBodySchema.validate(request.body);

		if (parsedBody.error) {
			throw createHttpError(400, parsedBody.error);
		}
		const id = validateInteger(cupId);
		const { visible } = parsedBody.value;

		const cup = await database.cup.update({
			where: { id },
			data: { public: visible },
		});
		response.json(cup).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error :
			createHttpError(
				500,
				`Error while updating visibility of cup "${cupId}".`,
			),
		);
	}
};

const cupNameBodySchema = Joi.object({
	name: Joi.string().required().min(1).max(100),
});

export const renameCup: RequestHandler = async (request, response, next) => {
	const { cupId } = request.params;
	try {
		const parsedBody = cupNameBodySchema.validate(request.body);

		if (parsedBody.error) {
			throw createHttpError(400, parsedBody.error);
		}
		const idAsNumber = validateInteger(cupId);
		const { name } = parsedBody.value;
		const cup = await database.cup.update({
			where: { id: idAsNumber },
			data: { name },
		});
		response.json(cup).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error :
			createHttpError(500, `Error while updating the name of cup "${cupId}".`),
		);
	}
};

export const deleteCup: RequestHandler = async (request, response, next) => {
	const { cupId } = request.params;
	try {
		const id = validateInteger(cupId);
		const cup = await database.cup.delete({
			where: { id },
		});
		response.json(cup).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, `Error while deleting cup ${cupId}`));
	}
};

export const setCupToCurrent: RequestHandler = async (
	request,
	response,
	next,
) => {
	const { cupId } = request.params;
	try {
		const id = validateInteger(cupId);
		await database.cup.updateMany({
			data: { current: false },
		});
		const cup = await database.cup.update({
			where: { id },
			data: { current: true },
		});
		response.json(cup).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, `Error while deleting cup ${cupId}.`));
	}
};

export const getCupDetails: RequestHandler = async (
	request,
	response,
	next,
) => {
	const { cupId } = request.params;
	try {
		const id = validateInteger(cupId);
		const cup = await database.cup.findUnique({
			where: { id },
			include: {
				qualifier: {
					include: { _count: { select: { results: true } } },
				},
				final: {
					include: { _count: { select: { results: true } } },
				},
				leaderboard: {
					include: { _count: { select: { entries: true } } },
				},
			},
		});
		response.json(cup).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, `Can't query cup with if ${cupId}`));
	}
};

const recordSchema = Joi.array().items(
	Joi.number().required(),
	Joi.number().required(),
	Joi.string().required(),
	Joi.string().required(),
	Joi.string().required(),
);

const dataSchema = Joi.object({
	data: Joi.array().items(recordSchema).min(1).required(),
	server: Joi.number().min(1).required()
});

export const updateQualifier: RequestHandler = async (
	request,
	response,
	next,
) => {
	const { qualifierId, cupId } = request.params;
	try {
		const qualifierIdAsNumber = validateInteger(qualifierId);
		const cupIdAsNumber = validateInteger(cupId);

		const parsedBody = dataSchema.validate(request.body);
		if (parsedBody.error) {
			throw createHttpError(400, parsedBody.error);
		}
		await updateResults(qualifierIdAsNumber, parsedBody.value.server, parsedBody.value.data);
		await updateLeaderboard(cupIdAsNumber)
		response.status(200).json({ success: true });
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(400, "Failed to parse data to leaderboard."));
	}
};

export const clearQualifier: RequestHandler = async (
	request,
	response,
	next,
) => {
	const { qualifierId, cupId } = request.params;
	try {
		const qualifierIdAsNumber = validateInteger(qualifierId);
		const cupIdAsNumber = validateInteger(cupId);
		await database.qualifierResult.deleteMany({
			where: {
				qualifierId: qualifierIdAsNumber,
			},
		});

		await updateLeaderboard(cupIdAsNumber);
		response.status(200).json({ success: true });
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error :
			createHttpError(500, `Failed to clear data of qualifier ${qualifierId}.`),
		);
	}
};

export const getAllCups: RequestHandler = async (request, response, next) => {
	try {
		const cups = await database.cup.findMany({
			orderBy: [{ year: "desc" }, { month: "desc" }],
		});
		response.json(cups).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, "Failed to load cups."));
	}
};

const cupQualifierBodySchema = Joi.object({
	version: Joi.number().required().min(1).max(100),
});

export const createQualifier: RequestHandler = async (request, response, next) => {
	try {
		const { cupId } = request.params;
		const id = validateInteger(cupId);
		const parsedBody = cupQualifierBodySchema.validate(request.body);
		if (parsedBody.error) {
			throw createHttpError(400, parsedBody.error);
		}

		const { version } = parsedBody.value;
		const qualifier = await database.qualifier.create({
			data: {
				cupId: id,
				version
			}
		});
		response.json(qualifier).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, "Failed create qualifier."));
	}
}

export const deleteQualifier: RequestHandler = async (request, response, next) => {
	try {
		const { qualifierId, cupId } = request.params;
		const qualifierIdAsNumber = validateInteger(qualifierId);
		const cupIdAsNumber = validateInteger(cupId);

		await database.qualifier.delete({
			where: { id: qualifierIdAsNumber }
		});
		await updateLeaderboard(cupIdAsNumber);
		response.json({ success: true }).status(200);
	} catch (error) {
		console.error(error);
		next(isHttpError(error) ? error : createHttpError(500, "Failed create qualifier."));
	}
}

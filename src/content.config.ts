import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
	loader: glob({
		base: './src/content/projects',
		pattern: '**/*.md',
	}),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		status: z.enum(['active', 'completed', 'archived']).default('active'),
		tags: z.array(z.string()).default([]),
		featured: z.boolean().default(false),
	}),
});

const experiments = defineCollection({
	loader: glob({
		base: './src/content/experiments',
		pattern: '**/*.md',
	}),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		status: z.enum(['idea', 'running', 'completed']).default('running'),
		tags: z.array(z.string()).default([]),
	}),
});

const notes = defineCollection({
	loader: glob({
		base: './src/content/notes',
		pattern: '**/*.md',
	}),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()).default([]),
	}),
});

export const collections = {
	projects,
	experiments,
	notes,
};
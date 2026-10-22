import { Router } from "express";
import { databaseState } from "../config/db.js";

const router = Router();
router.get("/", (_request, response) => response.json({ ok: true, database: databaseState() }));
export default router;

var express = require('express');
var router = express.Router();
var db = require('simple-postgres');


/**
 * Groups
 */
//Groups
router.get('/groups/:gid', (req, res, next) => {

});

//<editor-fold desc="Calendar">
/**
 * Calendar
 * Calendar ids are different than other ids. Since calendars are not actual DB objects,
 * their ID does not represent "real" objects. They are an encoded month and year.
 * As such, this is unique only within a group.
 * id: MMYYYY
 */
router.get('/groups/:gid/calendars/:cid', async (req, res, next) => {
    /* The encoded identifier for the calendar. in the form 122018 for december 2018 */
    const encID = req.params.cid;
    /* The last 4 character of the encID are a year */
    const year = parseInt(encID.substring(encID.length - 4));
    /* Everything but the last 4 characters are the month */
    const month = parseInt(encID.substring(0, encID.length - 4));

    const gid = req.params.gid;

    /** TODO: Make sure timezone wonkiness is fixed!*/
    console.dir(Date.UTC(year, month + 1, 0, 24));
    /** Now, we select all shifts falling within the first day of this month, and the 0th hour of the first day of the next month.*/
    const shifts = await db.rows `
        SELECT shift as id
        FROM shifts_by_group WHERE date BETWEEN ${new Date(year, month, 1, 0)} AND ${new Date(year, month + 1, 0, 24 - new Date().getTimezoneOffset())} 
            AND "group" = ${gid}
    `;

    /** Respond with the year, month, and shift ids. */
    res.json({
        id: req.params.cid,
        data: {
            year: year,
            month: month,
            shifts: shifts.map(s => s.id)
        }
    });
});

//</editor-fold>  Rel

//<editor-fold desc="Shifts">
/**
 * Shifts
 */

/** Create a new shift */
router.post('/groups/:gid/shifts', async (req, res, next) => {
    const gid = req.params.gid;
    const creator = 1;
    const {
        template, date, overrides_time, start_time, end_time, user
    } = req.body;

    if (
        template && date && overrides_time != undefined && creator
    ) {
        const shift = await db.row `
        INSERT INTO 
            shifts(
                template,
                date,
                creator,
                overrides_time,
                start_time,
                end_time,
                "user"
            )
            values(
                ${template},
                ${date},
                ${creator},
                ${overrides_time},
                ${start_time},
                ${end_time},
                ${user}
            )
            RETURNING id;
    `;
        res.json({
            id: shift.id
        });
    } else {
        res.sendStatus(400);
    }
});
/** Get information for specific shift.*/
router.get('/groups/:gid/shifts/:sid', async (req, res, next) => {
    const sid = req.params.sid;
    const shift = await db.row `
    SELECT 
        id,
        version,
        template,
        date,
        creator,
        overrides_time,
        start_time,
        end_time,
        user
    FROM shifts WHERE id = ${sid}
    `;
    if (shift) {
        const response = {
            id: sid,
            version: shift.version,
            data: shift
        }
        res.json(response);
    } else {
        res.sendStatus(400);
    }
});

/** Get all shifts for a group */
router.get('/groups/:gid/shifts', async(req, res, next) => {
    const gid = req.params.gid;
    const shifts = await db.rows`
        SELECT shift as id from shifts_by_group where "group" = ${gid}
    `;
    if(shifts){
        res.json({
            data:{
                shifts: shifts.map(s => s.id)
            }
        });
    }else{
        res.status(400);
    }
});

/** Update a shift. */
router.post('/groups/:gid/shifts/:sid', async (req, res, next) => {
    const sid = req.params.sid;
    const creator = 1;
    const {
        template, date, overrides_time, start_time, end_time, user
    } = req.body;

    if (
        template && date && overrides_time && start_time && end_time && creator
    ) {
        const shift = await db.row `
        UPDATE shifts 
            SET
                template = ${template},
                date = ${date},
                overrides_time = ${overrides_time},
                start_time = ${start_time},
                end_time = ${end_time},
                user = ${user}
        WHERE id = ${sid}`;

        res.json({
            id: shift.id
        });
    } else {
        res.sendStatus(400);
    }
})

//</editor-fold>

//<editor-fold desc="Templates">
/**
 * Templates
 */

/** Create a new template **/
router.post('/groups/:gid/templates', async (req, res, next) => {
    const gid = req.params.gid;
    const creator = 1;
    const {
        name, autofill, colour, start_time, end_time, stipend
    } = req.body;

    if (
        name && autofill && colour && start_time && end_time && stipend
    ) {
        const template = await db.row `
        INSERT INTO 
            templates(
                name,
                "group",
                creator,
                autofill,
                colour,
                start_time,
                end_time,
                stipend
            )
            values(
                ${name},
                ${gid},
                ${creator},
                ${JSON.stringify(autofill)},
                ${colour},
                ${start_time},
                ${end_time},
                ${stipend}
            )
            RETURNING id;
    `;
        res.json({
            id: template.id
        });
    } else {
        res.sendStatus(400);
    }
});

/** Get all templates for a specific group */
router.get('/groups/:gid/templates', async (req, res, next) => {
    const group = req.params.gid;
    const templates = await db.rows `
        SELECT id from TEMPLATES WHERE "group" = ${group} 
    `
    const response = {
        id: group,
        data: {
            templates: templates.map(t => t.id)
        }
    }
    res.json(response);
});

/** Get data for a specific template */
router.get('/groups/:gid/templates/:tid', async (req, res, next) => {
    const gid = req.params.gid;
    const tid = req.params.tid;

    const template = await db.row `
        SELECT 
            id,
            version,
            name,
            date_created,
            autofill,
            colour,
            start_time,
            end_time,
            stipend
        FROM templates
        WHERE id = ${tid}
    `;

    if (template) {
        const response = {
            id: tid,
            version: template.version,
            data: template
        }
        res.json(response);
    } else {
        res.sendStatus(404);
    }
});

/** Save updated data for a template */
router.post('/groups/:gid/templates/:tid', async (req, res, next) => {
    const tid = req.params.tid;
    const {
        name, autofill, colour, start_time, end_time, stipend
    } = req.body;
    if (
        name && autofill && colour && start_time && end_time && stipend
    ) {
        const template = await db.query `
        UPDATE templates
        SET
            name = ${name},
            autofill = ${JSON.stringify(autofill)},
            colour = ${colour},
            start_time = ${start_time},
            end_time = ${end_time},
            stipend = ${stipend}
        WHERE id = ${tid}
    `;
        res.json({id: tid});
    } else {
        res.sendStatus(400);
    }
});

/** Delete a template */
router.delete('/groups/:gid/templates/:tid', async(req, res, next) => {

});
//</editor-fold>

//<editor-fold desc="Switches">
router.get('/groups/:gid/switches', async (req, res, next) => {
   const gid = req.params.gid;
   const switches = await db.rows`
       SELECT switch as id
       FROM switches_by_group
       WHERE "group" = ${gid}
   `
   if(switches){
       res.json({
           id: gid,
           data: switches
       })
   } else{
       res.sendStatus(400);
   }
});
//</editor-fold>


module.exports = router;

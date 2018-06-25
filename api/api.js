const express = require('express');
const router = express.Router();
const db = require('simple-postgres');
const auth = require('../auth/auth');


//<editor-fold desc="Users">

/** Authenticate a user */
router.post('/users/login', async (req, res, next) => {
    auth.authenticateFromRequest(req, res);
});

/** Create a new user */
router.post('/users/signup', async (req, res, next) => {
    const {
        first_name, last_name, cell, email, password
    } = req.body;

    if (
        first_name && last_name && cell && email && password
    ) {
        const conflict = await db.row`
            SELECT EXISTS
                (SELECT id 
                FROM users
                WHERE email = ${email})
        `
        if (!conflict.exists) {
            const user = db.row `
        INSERT INTO 
            users(
                first_name,
                last_name,
                cell,
                email,
                hash
            )
            values(
                ${first_name},
                ${last_name},
                ${cell},
                ${email},
                crypt(${password}, gen_salt('md5'))
            )
            RETURNING id;
    `;
            user
                .then(u => {
                    auth.authenticateFromRequest(req, res);
                })
                .catch(e => {
                    console.dir(e);
                })
        } else {
            res.sendStatus(409);
        }
    } else {
        res.sendStatus(400);
    }
});

/**Get data for a user */
router.get('/users/:uid', auth.authenticateToken, async(req, res, next) => {
    const uid = req.params.uid;

    if(req.user.id == uid){
        const user = db.row`
            SELECT 
                u.id,
                version,
                first_name,
                last_name,
                cell,
                email,
                array_remove(array_agg(m."group"), null) as groups
            FROM users u
            JOIN memberships m ON m."user" = u.id
            WHERE
                u.id = ${uid}
            GROUP BY
                u.id,
                version,
                first_name,
                last_name,
                cell,
                email
        `
        user
            .then(u => {
                res.json({
                    id: u.id,
                    version: u.version,
                    data: u
                })
            })
            .catch(e => {
                res.sendStatus(500);
            })
    }else{
        res.sendStatus(403);
    }
})
//</editor-fold>

//<editor-fold desc = "Groups">

/**
 * Make sure that any time there is a group access,
 * make sure they have a valid token,
 * then that the user is part of the group.
 */
router.use('/groups/:gid', auth.authenticateToken, auth.checkIsMember, (req, res, next) => {
    next();
})

router.get('/groups/:gid', async (req, res, next) => {
    const gid = req.params.gid;

    const group = await db.row`
        SELECT
            g.id,
            g.version,
            g.name,
            g.tier,
            array_remove(array_agg(sw.switch), null) as switches,
            array_remove(array_agg(DISTINCT m.id), null) as memberships
        FROM groups g
        JOIN switches_by_group sw on sw."group" = g.id
        LEFT JOIN memberships m on m."group" = g.id 
        WHERE g.id = ${gid}
        GROUP BY
            g.id,
            g.version,
            g.name,
            g.tier
    `;
    if (group) {
        res.json({
            id: group.id,
            version: group.version,
            group: group
        })
    } else {
        res.sendStatus(404)
    }
});

//<editor-fold desc="Memberships">

/** Get all memberships for a group */
router.get('/groups/:gid/memberships', async (req, res, next) => {
    const gid = req.params.gid;

    const memberships = db.rows`
        SELECT id
        FROM memberships
        WHERE "group" = ${gid}
   `;

    memberships
        .then(m => {
            res.json({
                id: gid,
                data: m.map(m => m.id)
            })
        })
        .catch(e => {
            res.sendStatus(500);
        });
});

/** Get data for a specific membership */
router.get('/groups/:gid/memberships/:mid', async (req, res, next) => {
    const gid = req.params.gid;
    const mid = req.params.mid;

    const membership = db.row`
        SELECT
            m.id,
            first_name,
            last_name,
            status
        FROM memberships m
        JOIN users u
            ON m."user" = u.id
   `;

    membership
        .then(m => {
            res.json({
                id: gid,
                data: m
            })
        })
        .catch(e => {
            res.sendStatus(500);
        });
});

/**Set the clearance level for a member. */
router.post('/groups/:gid/memberships/:mid', auth.checkIsAdmin, async (req, res, next) => {
    const gid = req.params.gid;
    const mid = req.params.mid;

    const status = req.body.status;

    if (
        status == 'ADMIN' || status == 'STAFF' || status == 'OWNER'
    ) {
        const membership = db.row`
            UPDATE memberships
            SET status = ${status}
       `;

        membership
            .then(m => {
                res.json({
                    id: mid,
                })
            })
            .catch(e => {
                res.sendStatus(500);
            });
    } else {
        res.sendStatus(400);
    }
});

//</editor-fold>

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

    const first_date = new Date(year, month, 1, 0);
    const last_date = new Date(year, month + 1, 0, 24 - new Date().getTimezoneOffset() / 60);

    const shifts = db.rows `
        SELECT shift as id
        FROM shifts_by_group
        WHERE
            date BETWEEN ${first_date} AND ${last_date} AND
            "group" = ${gid}
    `;
    const availabilities = db.rows`
        SELECT id
        FROM availabilities
        WHERE 
            date BETWEEN ${first_date} AND ${last_date} AND
            "group" = ${gid}
    `;

    Promise.all([shifts, availabilities])
        .then(([shifts, availabilities]) => {
            /** Respond with the year, month, availability and shift ids. */
            res.json({
                id: req.params.cid,
                data: {
                    year: year,
                    month: month,
                    shifts: shifts.map(s => s.id),
                    availabilities: availabilities.map(a => a.id)
                }
            });
        });
});

//</editor-fold>  Rel

//<editor-fold desc="Shifts">

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
        "user"
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
        res.sendStatus(404);
    }
});

/** Get all shifts for a group */
router.get('/groups/:gid/shifts', async (req, res, next) => {
    const gid = req.params.gid;
    const shifts = await db.rows`
        SELECT shift as id from shifts_by_group where "group" = ${gid}
    `;
    if (shifts) {
        res.json({
            data: {
                shifts: shifts.map(s => s.id)
            }
        });
    } else {
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

/** Delete a shift */
router.post('/')
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
router.delete('/groups/:gid/templates/:tid', async (req, res, next) => {

});
//</editor-fold>

//<editor-fold desc="Switches">

//<editor-fold desc="Switch CRUD">
/** Create a new switch **/
router.post('/groups/:gid/switches', async (req, res, next) => {
    const gid = req.params.gid;
    const user = 1;
    const {
        shift, shift_requested, type, message
    } = req.body;

    if (
        shift && type && message
    ) {
        /**
         * Find any switches for this shift, where the switch is NOT:
         *      Filled but uncancelled,
         *      Cancelled and unfilled.
         */
        const conflict = await db.row`
            SELECT EXISTS 
                (SELECT id 
                FROM switches 
                WHERE shift = ${shift}
                AND (cancelled = false and acceptor !=null) 
                    OR (cancelled = true and acceptor = null))
        `;
        if (!conflict.exists) {
            const _switch = await db.row `
            INSERT INTO 
                switches(
                    shift,
                    shift_requested,
                    proposer,
                    type,
                    message
                )
                values(
                    ${shift},
                    ${shift_requested},
                    ${user},
                    ${type},
                    ${message}
                )
                RETURNING id;
            `;
            res.json({
                id: _switch.id
            });
        } else {
            res.sendStatus(409);
        }
    } else {
        res.sendStatus(400);
    }
});

/** Get all switches for a group */
router.get('/groups/:gid/switches', async (req, res, next) => {
    const gid = req.params.gid;
    const switches = await db.rows`
       SELECT switch as id
       FROM switches_by_group
       WHERE "group" = ${gid}
   `
    if (switches) {
        res.json({
            id: gid,
            data: switches.map(s => s.id)
        })
    } else {
        res.sendStatus(400);
    }
});

/** Get data for a specific switch */
router.get('/groups/:gid/switches/:sid', async (req, res, next) => {
    const gid = req.params.gid;
    const sid = req.params.sid;

    /** Get all relevant props from switches.
     * Also, array agg any responses to this switch by id.
     * We use an array_remove to remove any null elements from the array.
     * */
        //<editor-fold desc="query">
    const _switch = await db.row `
        SELECT 
            s.id,
            s.version,
            s.shift,
            s.shift_requested,
            s.type,
            s.proposer,
            s.acceptor,
            s.message,
            s.cancelled,
            array_remove(array_agg(r.id), null) as responses
        FROM switches s
            LEFT JOIN switchresponses r on r.switch = s.id
        WHERE s.id = ${sid}
        GROUP BY
            s.id,
            s.version,
            s.shift,
            s.shift_requested,
            s.type,
            s.proposer,
            s.acceptor,
            s.message,
            s.cancelled
    `;
    //</editor-fold>
    if (_switch) {
        res.json({
            id: sid,
            version: _switch.version,
            data: _switch
        });
    } else {
        res.sendStatus(404);
    }
});

/** TODO: Cancel a switch */
router.post('/groups/:gid/switches/:sid/cancel', (req, res, next) => {

});
//</editor-fold>
//<editor-fold desc="Responses">

/** Respond to a switch */
router.post('/groups/:gid/switches/:sid/responses/', async (req, res, next) => {
    const gid = req.params.gid;
    const sid = req.params.sid;

    const {
        user, affirmative, offer
    } = req.body;
    // We do switch seperately because it is a keyword, so can't do by name.
    const _switch = req.body.switch;
    /*
        We can only check the user and switch prop,
        because all others are nullable.
     */
    if (
        user && _switch && _switch == sid
    ) {
        const conflict = await db.row`
            SELECT EXISTS
                (SELECT id
                FROM switchresponses
                WHERE 
                    "user" = ${user} AND
                    "switch" = ${_switch})
        `;
        if (!conflict.exists) {
            /* Double ! the affirmative to trap an undefined into a false*/
            const response = await db.row `
        INSERT INTO 
            switchresponses(
                "user",
                affirmative,
                offer,
                switch
            )
            values(
                ${user},
                ${!!affirmative},
                ${offer},
                ${_switch}
            )
            RETURNING id;
        `;
            res.json({
                id: response.id
            });
        } else {
            res.sendStatus(409);
        }
    } else {
        res.sendStatus(400);
    }

});

/**Responses */
/** Get all responses for a switch*/
router.get('/groups/:gid/switches/:sid/responses', async (req, res, next) => {
    const sid = req.params.sid;
    const gid = req.params.gid;

    const responses = await db.rows`
        SELECT id from switchresponses WHERE switch = ${sid}
   `
    if (responses) {
        res.json({
            id: sid,
            data: responses.map(r => r.id)
        })
    }
});

/** Get data for a specific switch response */
router.get('/groups/:gid/switches/:sid/responses/:rid', async (req, res, next) => {
    const gid = req.params.gid;
    const sid = req.params.sid;
    const rid = req.params.rid;

    const response = await db.row`
        SELECT
            id,
            version,
            switch,
            "user",
            affirmative,
            offer,
            accepted,
            date_created
        FROM switchresponses
        WHERE id = ${rid}     
   `
    if (response) {
        res.json({
            id: response.id,
            version: response.version,
            data: response
        });
    } else {
        res.json(404);
    }
});

//</editor-fold>
//</editor-fold>

//<editor-fold desc="Availabilities">

/** Create a new availability on a given date */
router.post('/groups/:gid/availabilities', async (req, res, next) => {
    const gid = req.params.gid;
    const {
        user, day, night, date
    } = req.body;

    if (
        user && date
    ) {
        /**
         *Check to see if there is a conflicting availability.
         * If so do not continue.
         */
        const conflict = await db.row`
            SELECT EXISTS 
                (SELECT id 
                FROM availabilities 
                WHERE "group" = ${gid} AND 
                "user" = ${user} AND
                date = ${date})
        `;
        if (!conflict.exists) {
            const availability = await db.row `
            INSERT INTO 
                availabilities(
                    "group",
                    "user",
                    day,
                    night,
                    date
                )
                values(
                    ${gid},
                    ${user},
                    ${day},
                    ${night},
                    ${date}
                )
                RETURNING id;
            `;
            res.json({
                id: availability.id
            });
        } else {
            res.sendStatus(409);
        }
    } else {
        res.sendStatus(400);
    }
});

/** Get all availabilities for a group */
router.get('/groups/:gid/availabilities', async (req, res, next) => {
    const gid = req.params.gid;

    const availabilities = await db.rows`
        SELECT
            id
        FROM availabilities
        WHERE "group" = ${gid}
   `
    if (availabilities) {
        res.json({
            id: gid,
            data: availabilities.map(a => a.id)
        })
    } else {
        res.sendStatus(404);
    }
});

/** Get data for a specific availability*/
router.get('/groups/:gid/availabilities/:aid', async (req, res, next) => {
    const gid = req.params.gid;
    const aid = req.params.aid;

    const availability = await db.row`
        SELECT
            id,
            version,
            "user",
            day,
            night,
            date
        FROM availabilities
        WHERE
            id = ${aid} AND
            "group" = ${gid}     
   `;
    if (availability) {
        res.json({
            id: availability.id,
            version: availability.version,
            data: availability
        });
    } else {
        res.json(404);
    }
});

/** Save updated data for an availability */
router.post('/groups/:gid/availabilities/:aid', async (req, res, next) => {
    const gid = req.params.gid;
    const aid = req.params.aid;
    const {
        day, night
    } = req.body;
    if (
        day != undefined && night != undefined
    ) {
        const availability = await db.query `
        UPDATE availabilities
        SET
            day = ${day},
            night = ${night}
        WHERE id = ${aid} AND "group" = ${gid}
    `;
        res.json({id: aid});
    } else {
        res.sendStatus(400);
    }
});
//</editor-fold>

//</editor-fold>


module.exports = router;

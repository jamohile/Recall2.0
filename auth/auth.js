const db = require('simple-postgres');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT;

/**
 * Check if the user making this request is a member of the requested group.
 * @param req
 * @param res
 * @param next
 * @return {Promise<void>}
 */
exports.checkIsMember = async (req, res, next) => {
    const gid = req.params.gid;
    const user = req.user;
    if (user) {
        let status = await db.row `
            SELECT EXISTS
            (SELECT id
            FROM memberships
            WHERE 
                "group" = ${gid} AND
                "user" = ${user.id})
        `;
        //This membership exists.
        if (status.exists) {
            next();
        } else {
            res.sendStatus(403);
        }
    } else {
        if (process.env.NODE_ENV == 'development') {
            next();
        } else {
            res.sendStatus(403);
        }
    }
}

exports.checkIsAdmin = async (req, res, next) => {
    const gid = req.params.gid;
    const user = req.user;
    if (user) {
        let status = await db.row `
            SELECT
                (SELECT status
                FROM memberships
                WHERE 
                    "group" = ${gid} AND
                    "user" = ${user.id})
                = 'ADMIN' as isAdmin
        `;
        //This membership exists.
        if (status.isadmin) {
            next();
        } else {
            res.sendStatus(403);
        }
    } else {
        if (process.env.NODE_ENV == 'development') {
            next();
        } else {
            res.sendStatus(403);
        }
    }
}

/**
 * Uses tokenized user info to add a user prop to the request object.
 */
exports.addUserToRequest = async (req, res, next) => {

}

/** Check whether the given credentials are valid.
 *  Returns a promise which contains jwt token if alright.
 * @param {string} email
 * @param {string} hash
 * @return {Promise}
 */
exports.authenticate = async (email, password) => {
    const user = await db.row`
        SELECT id
        FROM users
        WHERE
            email = ${email} and
            hash = crypt(${password}, hash)
    `;
    if (user) {
        return user.id;
    } else {
        throw new Error(403);
    }
}

/**
 * Authenticates an email and password combination,
 * and returns a token if successful.
 * @param req
 * @param res
 * @return {Promise<void>}
 */
exports.authenticateFromRequest = async (req, res) => {
    const email = req.body.email;
    const password = req.body.password;

    exports.authenticate(email, password)
        .then(id => {
            let token = jwt.sign({
                id: id,
                date_signed: new Date().valueOf()
            }, JWT_SECRET)

            res.cookie('token', token);
            res.json({id: id, token: token});
        }).catch(status => res.sendStatus(status));
}

/** Checks whether a token is valid.
 *  If so, allows request to continue.
 *  Otherwise respond with a 401.*/
exports.authenticateToken = async(req, res, next) => {
    const token = req.cookies.token;
    let user;
    try{
       user =  jwt.decode(token, JWT_SECRET);
       if(user){
           req.user = user;
           next();
       }else{
           res.sendStatus(401);
       }
    }catch(e){
        res.sendStatus(401);
    }
}
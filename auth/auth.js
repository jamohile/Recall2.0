const db = require('simple-postgres');
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
            SELECT status
            FROM memberships
            WHERE 
                "group" = ${gid} AND
                "user" = ${user.id}
        `
        //This membership exists.
        if (status) {
            next();
        } else {
            res.sendStatus(401);
        }
    } else {
        if(process.env.NODE_ENV ==  'development'){
             next();
        }else{
            res.sendStatus(401);
        }
    }
}

/**
 * Uses tokenized user info to add a user prop to the request object.
 */
exports.addUserToRequest = async(req, res, next) => {

}
from flask import Blueprint, render_template, redirect, url_for, request, flash

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    """Render and process login portal requests."""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        # Simple validation
        if not username or not password:
            flash('Please fill in all security credentials.', 'error')
            return render_template('pages/auth/login.html')
            
        flash(f'Welcome back, Rescuer {username}! Authenticated successfully via satellite backup.', 'success')
        return redirect(url_for('home.index'))
        
    return render_template('pages/auth/login.html')

@auth_bp.route('/signup', methods=['GET', 'POST'])
def signup():
    """Render and process portal registration requests."""
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        
        if not username or not email or not password:
            flash('All safety registration parameters are required.', 'error')
            return render_template('pages/auth/signup.html')
            
        flash(f'Account created successfully for {username}! You are now protected on the road.', 'success')
        return redirect(url_for('auth.login'))
        
    return render_template('pages/auth/signup.html')

@auth_bp.route('/logout')
def logout():
    """Process portal logout signals."""
    flash('Satellite connection suspended safely. Logged out successfully.', 'info')
    return redirect(url_for('home.index'))
